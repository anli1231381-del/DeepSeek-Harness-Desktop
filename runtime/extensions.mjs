import { mkdir, readFile, writeFile, rename, readdir, lstat, realpath, rm } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { credential } from './connections.mjs';

const exec = promisify(execFile);
const clean = value => typeof value === 'string' ? value.trim() : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const inside = (root, file) => { const part = relative(root, file); return part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part); };
const MAX_FILES = 200, MAX_BYTES = 10 * 1024 * 1024;
const guide = 'https://git-scm.com/downloads/win';
async function atomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, value, { mode: 0o600 }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
function scopeOf(input) {
  const scope = input.scope || 'global';
  if (!['global', 'project'].includes(scope)) throw new Error('扩展范围无效');
  if (scope === 'project' && !clean(input.projectPath)) throw new Error('请选择项目');
  return { scope, projectPath: scope === 'project' ? resolve(input.projectPath) : '' };
}
function stringMap(value) {
  if (value === undefined) return {};
  if (!object(value) || Object.entries(value).some(([key, v]) => !key || typeof v !== 'string' || v.length > 16384 || /[\0\r\n]/.test(key))) throw new Error('环境变量和请求头应为字符串键值对象');
  return value;
}
export function validateMcp(input) {
  if (!object(input)) throw new Error('MCP 配置必须是对象');
  const name = clean(input.name || input.serverName);
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) throw new Error('MCP 名称需为 1–32 位字母、数字、短横线或下划线');
  const transport = input.transport || (input.url ? 'streamable-http' : 'stdio');
  const common = { name, transport, ...scopeOf(input) };
  if (transport === 'stdio') {
    const command = clean(input.command);
    if (!command || command.length > 4096 || /[\0\r\n]/.test(command)) throw new Error('请填写本地 MCP 启动程序');
    const args = input.args ?? [];
    if (!Array.isArray(args) || args.length > 100 || args.some(arg => typeof arg !== 'string' || arg.length > 16384 || arg.includes('\0'))) throw new Error('启动参数必须是字符串数组');
    return { ...common, command, args, cwd: clean(input.cwd), secret: stringMap(input.env) };
  }
  if (transport !== 'streamable-http') throw new Error('此 Harness 仅支持 stdio 和 Streamable HTTP，不支持旧版 SSE');
  let url;
  try { url = new URL(input.url); } catch { throw new Error('MCP 地址无效'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('MCP 地址不能包含凭证、参数或片段；凭证请放入请求头');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程 MCP 请使用 HTTPS');
  return { ...common, url: url.href, secret: stringMap(input.headers) };
}

export async function createExtensionManager({ stateDirectory, harnessPath } = {}) {
  if (!stateDirectory) throw new Error('缺少扩展数据目录');
  const root = resolve(stateDirectory, 'extensions'), stateFile = resolve(stateDirectory, 'extensions.json');
  let state = { skills: [], mcpServers: [] }, env = {}, queue = Promise.resolve();
  const loadedSkills = new Set(), loadedMcp = new Set();
  try { const data = JSON.parse(await readFile(stateFile, 'utf8')); if (!Array.isArray(data.skills) || !Array.isArray(data.mcpServers)) throw new Error('扩展数据格式无效'); state = data; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const save = async next => { await atomic(stateFile, JSON.stringify(next, null, 2)); state = next; };
  const applies = (entry, path) => entry.scope === 'global' || Boolean(path && resolve(path).toLowerCase() === entry.projectPath.toLowerCase());
  const managed = id => { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('扩展标识无效'); return join(root, id); };
  async function modulePath(packageName, subpath = 'lib/index.js') {
    const base = resolve(typeof harnessPath === 'function' ? harnessPath() : harnessPath || '.');
    const candidates = [join(base, '..', packageName, subpath), join(base, 'node_modules/@deepseek-ai', packageName, subpath), join(base, 'packages', packageName.replace('dsh-', ''), subpath)];
    for (const file of candidates) { try { if ((await lstat(file)).isFile()) return file; } catch {} }
    throw new Error('未找到兼容的 Harness 扩展运行环境，请先设置 Harness 安装目录');
  }
  async function catalog(dirs) {
    const { FileSystemSkillProvider } = await import(pathToFileURL(await modulePath('dsh-skill-filesystem')).href);
    const control = new AbortController();
    const provider = new FileSystemSkillProvider({ get: () => undefined, logger: { warn() {} } }, { signal: control.signal, invalidate() {} }, { includeDefaultRoots: false, customSkillDirs: dirs, watch: false });
    try { const result = await provider.list({}); return Array.isArray(result) ? result : result.candidates; }
    finally { control.abort(); await provider.dispose(); }
  }
  async function snapshot({ projectPath } = {}) {
    const skills = await Promise.all(state.skills.filter(item => applies(item, projectPath)).map(async item => {
      let status = 'disabled', validationError = '', discovered = false;
      try { const found = await catalog([managed(item.id)]); discovered = found.some(skill => skill.name === item.name && skill.invocation.modelInvocable); if (item.enabled) status = discovered ? 'discovered' : 'invalid'; }
      catch (error) { validationError = error.message; if (item.enabled) status = 'unavailable'; }
      return { ...item, status, discovered, loaded: loadedSkills.has(item.id), validationError };
    }));
    const mcpServers = state.mcpServers.filter(item => applies(item, projectPath)).map(({ encryptedSecret, ...item }) => ({ ...item, hasSecret: Boolean(encryptedSecret), loaded: loadedMcp.has(item.id) }));
    return { skills, mcpServers };
  }
  async function copyBundle(source, destination) {
    const original = resolve(source), actual = await realpath(original);
    if ((await lstat(original)).isSymbolicLink() || !(await lstat(actual)).isDirectory()) throw new Error('请选择普通技能文件夹，不支持符号链接');
    let count = 0, bytes = 0;
    async function visit(from, to) {
      await mkdir(to, { recursive: true });
      for (const entry of await readdir(from, { withFileTypes: true })) {
        if (['.git', 'node_modules', '.env'].includes(entry.name)) continue;
        const sourceFile = join(from, entry.name), target = join(to, entry.name);
        if (!inside(actual, sourceFile) || !inside(destination, target) || entry.isSymbolicLink()) throw new Error('技能包含不安全路径或符号链接');
        if (entry.isDirectory()) await visit(sourceFile, target);
        else if (entry.isFile()) {
          const info = await lstat(sourceFile);
          if (++count > MAX_FILES || (bytes += info.size) > MAX_BYTES) throw new Error('技能超过 200 个文件或 10 MB 的导入限制');
          await writeFile(target, await readFile(sourceFile), { mode: 0o600 });
        } else throw new Error('技能包含不支持的特殊文件');
      }
    }
    await visit(actual, destination);
  }
  async function importSkill(input, sourceMetadata) {
    const id = randomUUID(), directory = managed(id);
    try {
      await copyBundle(input.path, join(directory, 'bundle'));
      const found = await catalog([directory]);
      if (found.length !== 1) throw new Error('技能需要有效的 SKILL.md，包含 name 和 description 前置信息');
      const skill = found[0];
      const item = { id, name: skill.name, description: skill.description, ...scopeOf(input), enabled: true, source: sourceMetadata || { kind: 'local', path: resolve(input.path) }, createdAt: new Date().toISOString() };
      if (state.skills.some(other => other.name === item.name && other.scope === item.scope && other.projectPath === item.projectPath)) throw new Error('此范围已导入同名技能，请先移除旧版本');
      await save({ ...state, skills: [...state.skills, item] }); return item;
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }
  async function saveMcp(input) {
    const value = validateMcp(input), previous = input.id ? state.mcpServers.find(item => item.id === input.id) : null;
    if (input.id && !previous) throw new Error('MCP 不存在');
    if (state.mcpServers.some(item => item.id !== input.id && item.name === value.name && (item.scope === 'global' || value.scope === 'global' || item.projectPath === value.projectPath))) throw new Error('此范围已有同名 MCP');
    const { secret, ...fields } = value;
    const secretSupplied = input.env !== undefined || input.headers !== undefined;
    const encryptedSecret = Object.keys(secret).length ? await credential('protect', JSON.stringify(secret)) : secretSupplied ? '' : previous?.encryptedSecret || '';
    const item = { ...fields, id: previous?.id || randomUUID(), enabled: input.enabled ?? previous?.enabled ?? true, encryptedSecret, status: 'saved', tools: [], lastTest: null };
    await save({ ...state, mcpServers: [...state.mcpServers.filter(other => other.id !== item.id), item] });
    const { encryptedSecret: omitted, ...result } = item; return { ...result, hasSecret: Boolean(omitted) };
  }
  async function secretFor(item) { return item.encryptedSecret ? JSON.parse(await credential('unprotect', item.encryptedSecret)) : {}; }
  async function testMcp(id) {
    const item = state.mcpServers.find(entry => entry.id === id); if (!item) throw new Error('MCP 不存在');
    let client, transport, timer;
    try {
      const require = createRequire(await modulePath('dsh-mcp-client'));
      const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
      const secret = await secretFor(item);
      if (item.transport === 'stdio') {
        const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
        transport = new StdioClientTransport({ command: item.command, args: item.args, ...(item.cwd ? { cwd: item.cwd } : {}), env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '', ...secret }, stderr: 'ignore' });
      } else {
        const { StreamableHTTPClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href);
        transport = new StreamableHTTPClientTransport(new URL(item.url), { requestInit: { headers: secret } });
      }
      client = new Client({ name: 'harness-desktop-test', version: '1.0.0' });
      const work = async () => { await client.connect(transport); const result = await client.listTools(); return result.tools.map(tool => ({ name: tool.name, description: String(tool.description || '').slice(0, 2000) })); };
      const tools = await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('连接超时')), 15000); })]);
      await save({ ...state, mcpServers: state.mcpServers.map(entry => entry.id === id ? { ...entry, tools, status: 'tested', lastTest: new Date().toISOString(), testError: '' } : entry) });
      return { connected: true, tools };
    } catch {
      const testError = '连接失败：请检查启动程序是否安装、参数、地址和凭证；测试最长等待 15 秒';
      await save({ ...state, mcpServers: state.mcpServers.map(entry => entry.id === id ? { ...entry, status: 'failed', testError, lastTest: new Date().toISOString() } : entry) });
      return { connected: false, tools: [], error: testError };
    } finally { clearTimeout(timer); await client?.close().catch(() => {}); await transport?.close().catch(() => {}); }
  }
  async function patchFiles({ projectPath } = {}) {
    const skills = state.skills.filter(item => item.enabled && applies(item, projectPath));
    const servers = state.mcpServers.filter(item => item.enabled && applies(item, projectPath));
    env = {};
    const lines = ['- id: skill-filesystem', '  config:', '    customSkillDirs: ' + JSON.stringify(skills.map(item => managed(item.id)))];
    if (servers.length) {
      lines.push('- insert:');
      for (const item of servers) {
        const key = `HARNESS_DESKTOP_MCP_${item.id.replaceAll('-', '_')}`;
        env[key] = JSON.stringify(await secretFor(item));
        lines.push(`    - id: desktop-mcp-${item.id}`, "      name: '@deepseek-ai/dsh-mcp-client'", '      config:', `        serverName: ${JSON.stringify(item.name)}`, `        transport: ${item.transport}`, '        failOnStartupError: true');
        const fields = item.transport === 'stdio' ? { command: item.command, args: item.args, ...(item.cwd ? { cwd: item.cwd } : {}) } : { url: item.url };
        for (const [name, value] of Object.entries(fields)) lines.push(`        ${name}: ${JSON.stringify(value)}`);
        lines.push(`        ${item.transport === 'stdio' ? 'env' : 'headers'}: !!js ${JSON.stringify(`JSON.parse(process.env.${key} || '{}')`)}`);
      }
    }
    const hash = createHash('sha256').update(projectPath ? resolve(projectPath) : '').digest('hex').slice(0, 16);
    const file = join(root, `runtime-${hash}.patch.yml`); await atomic(file, lines.join('\n') + '\n'); return [file];
  }
  async function githubDownload(urlText) {
    let url; try { url = new URL(urlText); } catch { throw new Error('GitHub 链接无效'); }
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (url.hostname !== 'github.com' || url.protocol !== 'https:' || url.username || url.password || parts.length < 2 || (parts.length > 2 && parts[2] !== 'tree')) throw new Error('请使用 GitHub 仓库或 tree 技能目录链接');
    const [owner, repo] = parts, ref = parts[3] || 'HEAD', folder = parts.slice(4).join('/');
    if ([owner, repo, ...parts.slice(3)].some(part => !part || part === '.' || part === '..' || /[\\\0]/.test(part))) throw new Error('GitHub 路径无效');
    const api = async path => { const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${path}`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error('无法读取 GitHub 仓库，请检查链接、公开访问权限或 API 限额'); return response.json(); };
    const commitData = await api(`commits/${encodeURIComponent(ref)}`), commit = commitData.sha;
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('GitHub 返回无效提交');
    const temporary = join(root, `download-${randomUUID()}`); await mkdir(temporary, { recursive: true });
    let files = 0, bytes = 0;
    try {
      async function visit(path, target, depth = 0) {
        if (depth > 12) throw new Error('技能目录层级过深');
        const entries = await api(`contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`);
        if (!Array.isArray(entries)) throw new Error('请选择包含 SKILL.md 的技能目录');
        for (const entry of entries) {
          if (['.git', 'node_modules', '.env'].includes(entry.name)) continue;
          if (typeof entry.name !== 'string' || /[\\/\0]/.test(entry.name) || ['.', '..'].includes(entry.name)) throw new Error('GitHub 返回不安全文件路径');
          const file = resolve(target, entry.name); if (!inside(temporary, file)) throw new Error('文件超出导入目录');
          if (entry.type === 'dir') { await mkdir(file, { recursive: true }); await visit(entry.path, file, depth + 1); }
          else if (entry.type === 'file') {
            if (++files > MAX_FILES || !Number.isFinite(entry.size) || (bytes += entry.size) > MAX_BYTES) throw new Error('技能超过 200 个文件或 10 MB 的导入限制');
            const content = await api(`contents/${entry.path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`);
            if (content.type !== 'file' || content.encoding !== 'base64' || content.submodule_git_url || content.target) throw new Error('不支持符号链接或子模块');
            const buffer = Buffer.from(content.content, 'base64'); if (buffer.length !== entry.size) throw new Error('GitHub 文件大小不一致'); await writeFile(file, buffer, { mode: 0o600 });
          } else throw new Error('不支持符号链接或子模块');
        }
      }
      await visit(folder, temporary);
      return { path: temporary, source: { kind: 'github', url: url.href, repo: `${owner}/${repo}`, ref, commit, folder, dependencies: '仅复制技能资源，未执行脚本或安装依赖' } };
    } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
  }
  async function dispatchInner(operation, params = {}) {
    switch (operation) {
      case 'extensions_snapshot': return snapshot(params);
      case 'skill_import': return importSkill(params);
      case 'mcp_save': return saveMcp(params);
      case 'mcp_test': return testMcp(params.id);
      case 'mcp_import': {
        const data = typeof params.config === 'string' ? JSON.parse(params.config) : params.config;
        if (!object(data?.mcpServers)) throw new Error('请提供含 mcpServers 对象的 JSON 配置');
        const inputs = Object.entries(data.mcpServers).map(([name, value]) => ({ ...value, name, ...scopeOf(params) }));
        if (!inputs.length || inputs.length > 30) throw new Error('一次可导入 1–30 个 MCP');
        inputs.forEach(validateMcp);
        const imported = []; for (const input of inputs) imported.push(await saveMcp(input)); return { imported };
      }
      case 'skill_toggle': case 'mcp_toggle': case 'skill_remove': case 'mcp_remove': {
        const key = operation.startsWith('skill_') ? 'skills' : 'mcpServers';
        if (!state[key].some(item => item.id === params.id)) throw new Error('扩展不存在');
        if (operation.endsWith('toggle') && typeof params.enabled !== 'boolean') throw new Error('启用状态无效');
        const next = operation.endsWith('remove') ? state[key].filter(item => item.id !== params.id) : state[key].map(item => item.id === params.id ? { ...item, enabled: params.enabled } : item);
        await save({ ...state, [key]: next });
        if (key === 'skills' && operation.endsWith('remove')) await rm(managed(params.id), { recursive: true, force: true });
        return { ok: true };
      }
      case 'github_import': case 'github_update': {
        const old = operation === 'github_update' ? state.skills.find(item => item.id === params.id) : null;
        if (operation === 'github_update' && old?.source.kind !== 'github') throw new Error('只能更新由 GitHub 导入的技能');
        const download = await githubDownload(old?.source.url || params.url);
        try {
          if (!old) return await importSkill({ ...params, path: download.path }, download.source);
          const candidateRoot = join(root, `candidate-${randomUUID()}`); await mkdir(candidateRoot, { recursive: true });
          try {
            await copyBundle(download.path, join(candidateRoot, 'bundle'));
            const found = await catalog([candidateRoot]); if (found.length !== 1 || found[0].name !== old.name) throw new Error('更新后的技能无效或名称已变更');
            const directory = managed(old.id), backup = `${directory}.backup-${randomUUID()}`;
            await rename(directory, backup);
            try {
              await rename(candidateRoot, directory);
              const updated = { ...old, description: found[0].description, source: download.source, updatedAt: new Date().toISOString() };
              await save({ ...state, skills: state.skills.map(item => item.id === old.id ? updated : item) });
              await rm(backup, { recursive: true, force: true }); return updated;
            } catch (error) { await rm(directory, { recursive: true, force: true }); await rename(backup, directory); throw error; }
          } finally { await rm(candidateRoot, { recursive: true, force: true }); }
        } finally { await rm(download.path, { recursive: true, force: true }); }
      }
      case 'git_detect': {
        try { const result = await exec('git', ['--version'], { windowsHide: true, timeout: 5000 }); return { installed: true, version: result.stdout.trim(), guideUrl: guide }; }
        catch { return { installed: false, version: '', guideUrl: guide, message: '未检测到 Git；可安装 Git for Windows 后重启应用。' }; }
      }
      default: throw new Error('未知扩展操作');
    }
  }
  return { snapshot, patchFiles, environment: () => ({ ...env }), markLoaded(projectPath) { for (const item of state.skills) if (item.enabled && applies(item, projectPath)) loadedSkills.add(item.id); for (const item of state.mcpServers) if (item.enabled && applies(item, projectPath)) loadedMcp.add(item.id); }, dispatch(operation, params) { const result = queue.then(() => dispatchInner(operation, params)); queue = result.catch(() => {}); return result; } };
}
