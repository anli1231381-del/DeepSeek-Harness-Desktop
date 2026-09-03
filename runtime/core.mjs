import { access, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { validateConnection, credential, connectionPatch } from './connections.mjs';
import { fetchModels, harnessCatalog } from './discovery.mjs';

const exec = promisify(execFile);
const now = () => new Date().toISOString();
const defaults = { harnessPath: '', provider: 'deepseek-official', model: 'deepseek-v4-flash', activeConnectionId: '' };
const text = value => typeof value === 'string' ? value : '';
const errorText = error => text(error?.message || String(error)).replace(/\bsk-[\w-]+/g, '[已隐藏凭证]').slice(0, 2400);
const blocksText = blocks => Array.isArray(blocks) ? blocks.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';

export async function safeFile(root, name) {
  if (!text(name) || isAbsolute(name) || name.includes('\0')) throw new Error('请使用项目内相对路径');
  if (name.split(/[\\/]/).some(part => part.toLowerCase() === '.git')) throw new Error('不能读取 Git 内部文件');
  const base = await realpath(root);
  const file = resolve(base, name);
  const inside = target => { const part = relative(base, target); return part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part); };
  if (!inside(file)) throw new Error('文件超出项目目录');
  let ancestor = file;
  let actual;
  while (!actual) {
    try { actual = resolve(await realpath(ancestor), relative(ancestor, file)); }
    catch (error) {
      if (error.code !== 'ENOENT' || ancestor === dirname(ancestor)) throw error;
      ancestor = dirname(ancestor);
    }
  }
  if (!inside(actual)) throw new Error('文件链接指向项目目录外');
  if (relative(base, actual).split(/[\\/]/).some(part => part.toLowerCase() === '.git')) throw new Error('不能读取 Git 内部文件');
  return actual;
}

export function finishStatus(events) {
  const reason = events.findLast(event => event.type === 'turn/end')?.data?.reason?.kind;
  return reason === 'completed' ? 'completed' : reason === 'aborted' ? 'stopped' : 'failed';
}

export function summarizeEvent(notification, formatError = errorText) {
  const at = now();
  if (notification.method === 'subagent.started') return { at, kind: 'info', label: '已启动协作子任务' };
  if (notification.method === 'subagent.finished') return { at, kind: notification.params?.status === 'ok' ? 'success' : 'error', label: '协作子任务已结束' };
  const event = notification.params?.event;
  if (!event) return null;
  const data = event.data ?? {};
  switch (event.type) {
    case 'turn/start': return { at, kind: 'info', label: 'AI 开始处理任务' };
    case 'tool/call': return { at, kind: 'tool', label: `正在调用 ${text(data.name) || '工具'}` };
    case 'tool/result': return { at, kind: data.error || data.message?.isError ? 'error' : 'success', label: data.error || data.message?.isError ? '工具执行遇到问题' : '工具执行完成' };
    case 'assistant/message': return { at, kind: 'info', label: 'AI 已更新回复' };
    case 'todo/write': return { at, kind: 'info', label: '已更新工作计划' };
    case 'approval/asked': return { at, kind: 'error', label: '操作需要权限确认', detail: '请先停止任务，然后在 Harness 中处理权限确认。' };
    case 'llm/retry': case 'llm/retry-started': return { at, kind: 'info', label: '模型请求正在重试' };
    case 'turn/end': return { at, kind: data.reason?.kind === 'completed' ? 'success' : 'error', label: data.reason?.kind === 'completed' ? 'AI 已完成本轮工作' : '本轮工作未正常完成', detail: formatError(data.reason?.error || data.reason?.kind || '') };
    default: return null;
  }
}

async function detectRuntime(settings, resourceRoot) {
  const candidates = settings.harnessPath ? [settings.harnessPath] : [
    process.env.HARNESS_DESKTOP_HARNESS,
    resourceRoot && join(resourceRoot, 'harness/node_modules/@deepseek-ai/dsh'),
    resourceRoot && join(resourceRoot, 'harness'),
    join(homedir(), 'deepseek-harness'),
    process.env.APPDATA && join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = resolve(candidate);
    const source = existsSync(join(root, 'apps/cli/package.json'));
    const manifestPath = join(root, source ? 'apps/cli/package.json' : 'package.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.name !== '@deepseek-ai/dsh') continue;
      const bin = join(root, source ? 'apps/cli/lib/bin.js' : 'lib/bin.js');
      const sdkCandidates = source ? [join(root, 'packages/sdk/client/lib/index.js')] : [join(root, '../dsh-sdk-client/lib/index.js'), join(root, 'node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js')];
      const sdk = sdkCandidates.find(existsSync);
      const valid = existsSync(bin) && Boolean(sdk);
      return { available: valid, connected: false, nodeVersion: process.version, nodePath: process.execPath, harnessPath: root, harnessVersion: manifest.version, source: resourceRoot && root.startsWith(resolve(resourceRoot) + sep) ? 'bundled' : 'local', message: valid ? '已找到运行环境，点击“检测并验证连接”确认是否就绪' : '运行环境文件不完整，请重新安装应用或选择完整的 Harness 安装目录', bin, sdk };
    } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) continue; }
  }
  return { available: false, connected: false, nodeVersion: process.version, nodePath: process.execPath, harnessPath: settings.harnessPath || '', harnessVersion: '', source: 'missing', message: '未找到可用 Harness，请在设置中选择安装目录' };
}

async function git(project, args) {
  const result = await exec('git', ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.quotepath=false', '-C', project.path, ...args], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return result.stdout;
}

async function changes(project) {
  try {
    const prefix = (await git(project, ['rev-parse', '--show-prefix'])).trimEnd();
    const records = (await git(project, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'])).split('\0');
    const files = [];
    for (let i = 0; i < records.length; i++) {
      if (!records[i]) continue;
      const status = records[i].slice(0, 2);
      const path = records[i].slice(3);
      const original = status.includes('R') || status.includes('C') ? records[++i] : null;
      if (!path.startsWith(prefix)) continue;
      files.push({ path: path.slice(prefix.length), status: status.trim(), ...(original?.startsWith(prefix) ? { oldPath: original.slice(prefix.length) } : {}) });
    }
    return { git: true, files, message: '所选项目的全部未提交修改（包括任务开始前的修改）' };
  } catch (error) {
    if (error.code === 'ENOENT') return { git: false, files: [], message: '尚未安装 Git，任务仍可使用；安装 Git for Windows 后可查看文件修改对比。' };
    if (/not a git repository/i.test(error.stderr || '')) return { git: false, files: [], message: '此目录尚未启用 Git，暂时无法查看修改对比' };
    throw new Error(`无法读取 Git 状态：${errorText(error.stderr || error)}`);
  }
}

export async function createController({ stateFile, resourceRoot, onChanged = () => {} } = {}) {
  if (!stateFile) throw new Error('缺少应用数据路径');
  let state = { projects: [], tasks: [], connections: [], settings: { ...defaults } };
  try {
    const loaded = JSON.parse(await readFile(stateFile, 'utf8'));
    if (!Array.isArray(loaded.projects) || !Array.isArray(loaded.tasks) || !loaded.settings) throw new Error('应用数据格式无效');
    state = loaded;
    state.settings = { ...defaults, ...state.settings };
    state.connections ??= [];
    if (!Array.isArray(state.connections)) throw new Error('API 配置格式无效');
    for (const task of state.tasks) if (task.status === 'running') Object.assign(task, { status: 'stopped', stage: '运行已中断', finishedAt: now(), error: '上次应用退出时任务尚未完成，请重新发起任务。' });
  } catch (error) { if (error.code !== 'ENOENT') throw new Error(`无法加载应用数据，原文件已保留：${errorText(error)}`); }
  let runtime = await detectRuntime(state.settings, resourceRoot);
  const secrets = new Set();
  const redact = value => { let result = text(value); for (const secret of secrets) result = result.replaceAll(secret, '[已隐藏凭证]'); return result; };
  const failureText = error => errorText(redact(error?.message || String(error)));
  let active = null;
  let checking = false;
  let closing = false;
  let cleanupFailure = false;
  let writes = Promise.resolve();
  const snapshot = () => structuredClone({ ...state, connections: state.connections.map(({ encryptedApiKey, ...connection }) => ({ ...connection, hasApiKey: Boolean(encryptedApiKey) })), runtime: { ...runtime, busy: Boolean(active || checking), bin: undefined, sdk: undefined } });
  function persist() {
    const next = writes.catch(() => {}).then(async () => {
      await mkdir(dirname(stateFile), { recursive: true });
      const temp = `${stateFile}.tmp`;
      // Serialize when the queued write executes so a failed mutation's rollback wins.
      await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(temp, stateFile);
    });
    writes = next;
    return next;
  }
  async function publish() { await persist(); onChanged(); return snapshot(); }
  async function replaceField(field, value) {
    const before = state[field];
    state[field] = value;
    try { return await publish(); } catch (error) { state[field] = before; throw error; }
  }
  function failedCleanup(error) {
    cleanupFailure = true;
    runtime.available = false;
    runtime.connected = false;
    runtime.message = `无法确认运行进程已退出，请重新启动应用：${failureText(error)}`;
    return runtime.message;
  }
  function projectFor(id) {
    const project = state.projects.find(p => p.id === id);
    if (!project) throw new Error('请先选择一个项目');
    return project;
  }
  async function makeHarness(project) {
    if (!runtime.available) throw new Error(runtime.message);
    const { DeepSeekHarness } = await import(pathToFileURL(runtime.sdk).href);
    let route = { provider: state.settings.provider, model: state.settings.model };
    if (state.settings.activeConnectionId) {
      const connection = state.connections.find(item => item.id === state.settings.activeConnectionId);
      if (!connection) throw new Error('所选 API 配置不存在，请重新选择');
      const key = connection.encryptedApiKey ? await credential('unprotect', connection.encryptedApiKey) : 'local-no-key';
      if (connection.encryptedApiKey) secrets.add(key);
      const patch = join(dirname(stateFile), 'model.patch.yml');
      await mkdir(dirname(stateFile), { recursive: true });
      await writeFile(patch, JSON.stringify(connectionPatch(connection)), { mode: 0o600 });
      route = { provider: `desktop-${connection.id}`, model: connection.model, patches: [patch], maxTokens: 4096, env: { ...process.env, HARNESS_DESKTOP_MODEL_KEY: key } };
    }
    return new DeepSeekHarness({ dshBin: runtime.bin, cwd: project.path, processCwd: project.path, ...route, initializeTimeoutMs: 30000, requestTimeoutMs: 30000 });
  }
  async function run(job) {
    const { harness, task } = job;
    try {
      const result = await harness.run(task.prompt, { sessionId: task.id, onNotification: notification => {
        if (task.status !== 'running') return;
        const activity = summarizeEvent(notification, failureText);
        if (activity?.detail) activity.detail = redact(activity.detail);
        const rootEvent = notification.params?.sessionId === task.id;
        if (activity) {
          task.activities.push(activity);
          // ponytail: retain 500 visible records per task; Harness owns its complete durable log.
          if (task.activities.length > 500) task.activities.shift();
          if (rootEvent) task.stage = activity.label;
          else activity.label = `子任务：${activity.label}`;
        }
        const event = notification.params?.event;
        if (rootEvent && event?.type === 'assistant/message') task.response = redact(blocksText(event.data?.message?.content)).slice(0, 200000);
        if (activity) {
          onChanged();
          persist().catch(error => { task.error = `保存任务记录失败：${failureText(error)}`; onChanged(); });
        }
      } });
      if (task.status === 'running') {
        task.status = finishStatus(result.events);
        task.response = redact(result.finalResponse).slice(0, 200000);
        if (task.status === 'failed') task.error = failureText(result.events.findLast(e => e.type === 'turn/end')?.data?.reason?.error || '模型未正常完成，请查看工作记录');
      }
    } catch (error) {
      if (task.status === 'running') { task.status = 'failed'; task.error = failureText(error); }
    } finally {
      task.finishedAt = now();
      task.stage = { completed: '任务已完成', stopped: '任务已停止', failed: '任务未完成' }[task.status] || '任务已结束';
      try { await harness.close(); if (active === job) active = null; }
      catch (error) { task.error = failedCleanup(error); task.status = 'failed'; task.stage = '运行环境需要重启'; }
      await publish().catch(error => { task.error = `保存任务记录失败：${failureText(error)}`; onChanged(); });
    }
  }
  const controller = {
    async dispatch(operation, params = {}) {
      if (closing) throw new Error('应用正在关闭');
      if (cleanupFailure && !['snapshot', 'changes', 'diff'].includes(operation)) throw new Error(runtime.message);
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('操作参数无效');
      switch (operation) {
        case 'snapshot': return snapshot();
        case 'harness_catalog': {
          if (params.harnessPath !== undefined && (typeof params.harnessPath !== 'string' || params.harnessPath.length > 4096)) throw new Error('Harness 路径无效');
          return harnessCatalog(params.harnessPath === undefined ? runtime : await detectRuntime({ ...state.settings, harnessPath: params.harnessPath.trim() }, resourceRoot));
        }
        case 'api_models': {
          const input = params.connection;
          const valid = validateConnection({ ...input, name: '模型检测', model: '未选择' });
          const previous = state.connections.find(item => item.id === input?.id);
          if (input?.id && !previous) throw new Error('API 配置不存在');
          let key = text(input?.apiKey).trim();
          if (!key && previous?.encryptedApiKey && !input.clearApiKey) {
            if (valid.baseUrl !== previous.baseUrl || valid.protocol !== previous.protocol) throw new Error('更换 API 地址或协议后，请重新填写密钥');
            key = await credential('unprotect', previous.encryptedApiKey);
          }
          if (key) secrets.add(key);
          try { return await fetchModels(valid, key); }
          catch (error) { throw new Error(failureText(error)); }
        }
        case 'add_project': {
          if (!text(params.path).trim() || !isAbsolute(params.path)) throw new Error('请选择项目的完整目录路径');
          const path = await realpath(params.path.trim());
          if (!(await stat(path)).isDirectory()) throw new Error('项目路径必须是目录');
          const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
          if (state.projects.some(p => key(p.path) === key(path))) return snapshot();
          return replaceField('projects', [{ id: randomUUID(), name: basename(path), path, updatedAt: now() }, ...state.projects]);
        }
        case 'remove_project': {
          projectFor(params.projectId);
          if (active?.task.projectId === params.projectId) throw new Error('请先停止此项目的任务');
          return replaceField('projects', state.projects.filter(p => p.id !== params.projectId));
        }
        case 'save_settings': {
          if (active || checking) throw new Error('请在运行结束后修改设置');
          const input = params.settings;
          if (!input || !text(input.provider).trim() || !text(input.model).trim() || typeof input.harnessPath !== 'string') throw new Error('请填写模型和服务提供方');
          if (input.provider.length > 200 || input.model.length > 200 || input.harnessPath.length > 4096) throw new Error('设置内容过长');
          const activeConnectionId = text(input.activeConnectionId);
          if (activeConnectionId && !state.connections.some(item => item.id === activeConnectionId)) throw new Error('所选 API 配置不存在');
          const next = { harnessPath: input.harnessPath.trim(), provider: input.provider.trim(), model: input.model.trim(), activeConnectionId };
          await replaceField('settings', next);
          runtime = await detectRuntime(next, resourceRoot);
          onChanged(); return snapshot();
        }
        case 'save_connection': {
          if (active || checking) throw new Error('请在运行结束后修改 API 配置');
          const input = params.connection;
          const valid = validateConnection(input);
          const previous = state.connections.find(item => item.id === input.id);
          if (input.id && !previous) throw new Error('API 配置不存在');
          if (!previous && state.connections.length >= 50) throw new Error('最多保存 50 组 API 配置');
          const key = text(input.apiKey).trim();
          if (previous?.encryptedApiKey && !key && !input.clearApiKey && (valid.baseUrl !== previous.baseUrl || valid.protocol !== previous.protocol)) throw new Error('更换 API 地址或协议后，请重新填写密钥，或明确清除密钥');
          const encryptedApiKey = key ? await credential('protect', key) : input.clearApiKey ? '' : previous?.encryptedApiKey || '';
          const next = { ...valid, id: previous?.id || randomUUID(), encryptedApiKey };
          await replaceField('connections', previous ? state.connections.map(item => item.id === previous.id ? next : item) : [...state.connections, next]);
          runtime.connected = false; onChanged(); return snapshot();
        }
        case 'remove_connection': {
          if (active || checking) throw new Error('请在运行结束后删除 API 配置');
          if (!state.connections.some(item => item.id === params.id)) throw new Error('API 配置不存在');
          const before = state;
          state = { ...state, connections: state.connections.filter(item => item.id !== params.id), settings: { ...state.settings, activeConnectionId: state.settings.activeConnectionId === params.id ? '' : state.settings.activeConnectionId } };
          try { await publish(); } catch (error) { state = before; throw error; }
          runtime.connected = false; onChanged(); return snapshot();
        }
        case 'check_runtime': {
          if (active || checking) throw new Error('运行中，请稍后验证连接');
          checking = true;
          let harness;
          try {
            runtime = await detectRuntime(state.settings, resourceRoot);
            harness = await makeHarness({ path: state.projects[0]?.path || homedir() });
            await harness.start();
            runtime.connected = true;
            runtime.message = '运行环境已就绪，可以开始任务';
          } catch (error) { runtime.connected = false; runtime.message = `连接验证失败：${failureText(error)}`; }
          finally { try { await harness?.close(); } catch (error) { failedCleanup(error); } checking = false; }
          onChanged(); return snapshot();
        }
        case 'start_task': {
          if (active || checking) throw new Error('请等待当前任务或连接验证结束');
          const project = projectFor(params.projectId);
          const prompt = text(params.prompt).trim();
          if (!prompt || prompt.length > 50000) throw new Error('请填写目标，长度不超过 50000 字');
          await access(project.path);
          const harness = await makeHarness(project);
          const task = { id: `desktop-${randomUUID()}`, projectId: project.id, prompt, status: 'running', startedAt: now(), stage: '正在连接运行环境', activities: [{ at: now(), kind: 'info', label: '任务已创建，正在连接 Harness' }], response: '' };
          project.updatedAt = now();
          state.tasks.unshift(task);
          const job = { harness, task, promise: null };
          active = job;
          try { await publish(); } catch (error) { active = null; state.tasks.shift(); await harness.close(); throw error; }
          job.promise = run(job);
          return snapshot();
        }
        case 'stop_task': {
          if (active) {
            const job = active;
            job.task.status = 'stopped'; job.task.stage = '正在停止任务';
            onChanged();
            await job.harness.close();
            await job.promise;
          }
          return snapshot();
        }
        case 'changes': return changes(projectFor(params.projectId));
        case 'diff': {
          const project = projectFor(params.projectId);
          const file = await safeFile(project.path, params.path);
          const listed = (await changes(project)).files.find(f => f.path === params.path);
          if (!listed) throw new Error('该文件不在当前修改列表中，请刷新');
          if (listed.status === '??') {
            if ((await stat(file)).size > 512 * 1024) return '文件超过 512 KB，请在编辑器中查看。';
            const content = await readFile(file);
            return content.includes(0) ? '二进制文件，无法显示文本预览。' : `新增文件：${params.path}\n\n${content.toString('utf8')}`;
          }
          let hasHead = true;
          try { await git(project, ['rev-parse', '--verify', 'HEAD']); } catch { hasHead = false; }
          const paths = [params.path];
          if (listed.oldPath) { await safeFile(project.path, listed.oldPath); paths.push(listed.oldPath); }
          const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames'];
          const diff = hasHead ? await git(project, [...args, 'HEAD', '--', ...paths]) : (await git(project, [...args, '--cached', '--', ...paths])) + (await git(project, [...args, '--', ...paths]));
          return diff.slice(0, 512 * 1024) || '文件状态已变化，但没有可显示的文本差异。';
        }
        default: throw new Error('不支持的操作');
      }
    },
    async close() {
      closing = true;
      if (active) { const job = active; job.task.status = 'stopped'; await job.harness.close(); await job.promise; }
      await writes;
    },
  };
  return controller;
}
