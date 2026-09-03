import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { validateConnection } from './connections.mjs';

const exec = promisify(execFile);
const deepseekModels = ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp'];
function modelList(items) {
  const models = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = typeof item === 'string' ? item : item?.id;
    if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\r\n\0]/.test(id)) continue;
    const label = item?.display_name || item?.name;
    models.set(id, { id, name: typeof label === 'string' ? label.slice(0, 200) : id });
    if (models.size >= 5000) break;
  }
  return [...models.values()];
}

// A listing is metadata only: no completion request, server response body, or credential is logged.
export async function fetchModels(input, apiKey) {
  const connection = validateConnection({ ...input, name: '模型检测', model: '未选择' });
  // DeepSeek exposes one catalog for both its OpenAI and Anthropic compatible APIs.
  const parsed = new URL(connection.baseUrl);
  const deepseek = parsed.origin === 'https://api.deepseek.com' && ['/', '/v1', '/anthropic'].includes(parsed.pathname.replace(/\/$/, '') || '/');
  const anthropic = !deepseek && connection.protocol === 'anthropic-messages';
  const url = new URL(deepseek ? 'https://api.deepseek.com/models' : `${connection.baseUrl}${anthropic ? '/v1/models' : '/models'}`);
  if (anthropic) url.searchParams.set('limit', '1000');
  const headers = { Accept: 'application/json', ...(anthropic ? { 'anthropic-version': '2023-06-01' } : {}) };
  if (apiKey) headers[anthropic ? 'x-api-key' : 'Authorization'] = anthropic ? apiKey : `Bearer ${apiKey}`;
  const models = [];
  const signal = AbortSignal.timeout(15000);
  const cursors = new Set();
  let hasMore = false;
  for (let page = 0; page < 5; page++) {
    let response;
    try { response = await fetch(url, { headers, signal, redirect: 'error' }); }
    catch { throw new Error('无法获取模型：请检查 API 地址与网络，或手动填写模型 ID。'); }
    try {
      if (!response.ok) {
        if ([401, 403].includes(response.status)) throw new Error('密钥无效或没有模型列表访问权限，请检查 API 密钥。');
        if ([404, 405].includes(response.status)) throw new Error('此 API 未提供模型列表接口，请手动填写模型 ID。');
        throw new Error(`获取模型失败（HTTP ${response.status}），请稍后重试或手动填写。`);
      }
      let size = 0; const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) throw new Error('模型列表过大，请手动填写模型 ID。');
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new Error('API 返回的模型列表格式无效，请检查地址或手动填写。'); }
      if (!Array.isArray(body.data)) throw new Error('API 未返回可识别的模型列表，请手动填写模型 ID。');
      models.push(...modelList(body.data));
      hasMore = body.has_more === true;
      if (!anthropic || !hasMore) break;
      if (typeof body.last_id !== 'string' || !body.last_id || cursors.has(body.last_id)) throw new Error('模型列表分页异常，请手动填写模型 ID。');
      cursors.add(body.last_id); url.searchParams.set('after_id', body.last_id);
    } catch (error) {
      if (signal.aborted) throw new Error('获取模型超时，请稍后重试或手动填写模型 ID。');
      throw error;
    } finally { if (response.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
  }
  const list = modelList(models).filter(model => !apiKey || !JSON.stringify(model).includes(apiKey));
  if (!list.length) throw new Error('API 返回的模型列表为空，请确认密钥权限，或手动填写模型 ID。');
  return { models: list, message: `已获取 ${list.length} 个模型。${hasMore ? '列表未完全返回，未列出的模型可手动填写。' : ''}选择后保存，实际调用以服务商权限为准。` };
}

export async function harnessCatalog(runtime) {
  if (!runtime.available) throw new Error(runtime.message);
  try {
    const require = createRequire(runtime.bin);
    const yaml = require('js-yaml');
    // Parse expressions as inert markers. Detecting config must never evaluate !!js.
    const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: () => undefined })]);
    const { stdout } = await exec(process.execPath, [runtime.bin, '--profile', 'sdk', '--dump-config'], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    const rows = yaml.load(stdout, { schema });
    const flatten = list => (Array.isArray(list) ? list : []).flatMap(row => row?.disabled ? [] : row?.group ? flatten(row.config) : [row]);
    const entries = flatten(rows);
    const settingsEntry = entries.find(row => String(row?.name).includes('dsh-settings-file'));
    let saved = {};
    if (settingsEntry) {
      const config = settingsEntry.config || {};
      const file = resolve(config.path || join(config.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'), 'settings.yaml'));
      try { saved = yaml.load(await readFile(file, 'utf8'), { schema }) || {}; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const providers = new Map();
    for (const row of entries) {
      const name = String(row?.name || '');
      if (name.includes('dsh-llm-deepseek')) {
        const config = { ...row.config, ...saved['llm-deepseek'] };
        providers.set('deepseek-official', { id: 'deepseek-official', name: 'DeepSeek', models: modelList(config.models ?? deepseekModels) });
      }
      if (name.includes('dsh-llm-pi-ai')) {
        const base = row.config?.providers || {};
        const overlay = saved['llm-pi-ai']?.providers || {};
        for (const id of new Set([...Object.keys(base), ...Object.keys(overlay)])) {
          const config = { ...base[id], ...overlay[id] };
          providers.set(id, { id, name: typeof config.displayName === 'string' ? config.displayName : id, models: modelList(config.models) });
        }
      }
    }
    return { providers: [...providers.values()], message: `检测到 ${providers.size} 个 Harness 服务商。模型来自已有配置；密钥与额度将在实际任务中验证。` };
  } catch { throw new Error('无法读取 Harness 配置，请检查安装路径或手动填写服务商与模型。'); }
}
