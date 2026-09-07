import { access, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { scanWorkspace, collectArtifacts, hashFile } from './artifacts.mjs';
import { validateConnection, credential, connectionPatch } from './connections.mjs';
import { migrateOldTasksToSnapshot } from './migration.js';
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

export async function createController({ stateFile, resourceRoot, onChanged = () => {}, _test_inject = {} } = {}) {
  if (!stateFile) throw new Error('缺少应用数据路径');
  // canonical normalized state: top-level collections for sessions/messages/executions/artifacts
  let state = { projects: [], sessions: [], messages: [], executions: [], artifacts: [], tasks: [], connections: [], settings: { ...defaults } };
  // Test injection for simulating failures in tests
  const testInject = _test_inject || {};
  try {
    const raw = await readFile(stateFile, 'utf8').catch(err => { if (err.code === 'ENOENT') return null; throw err; });
    if (raw) {
      const loaded = JSON.parse(raw);
      for (const key of ['messages', 'executions', 'artifacts']) {
        if (loaded[key] !== undefined && !Array.isArray(loaded[key])) throw new Error('应用数据格式无效：' + key + ' 必须为数组');
      }
      if (loaded.sessions !== undefined && !Array.isArray(loaded.sessions)) throw new Error('应用数据格式无效：sessions 必须为数组');
      state.projects = Array.isArray(loaded.projects) ? loaded.projects : [];
      state.settings = { ...defaults, ...(loaded.settings || {}) };
      state.connections = Array.isArray(loaded.connections) ? loaded.connections : [];
      state.tasks = Array.isArray(loaded.tasks) ? loaded.tasks.map(task => ({ ...task })) : [];
      // Support older snapshots that embedded messages/executions/artifacts inside sessions.
      if (Array.isArray(loaded.sessions)) {
        // extract nested collections into top-level arrays
        const msgs = [];
        const exs = [];
        const arts = [];
        const sessions = loaded.sessions.map(s => {
          if (Array.isArray(s.messages)) msgs.push(...s.messages.map(m => ({ ...m, sessionId: s.id })));
          if (Array.isArray(s.executions)) exs.push(...s.executions.map(e => ({ ...e, sessionId: s.id })));
          if (Array.isArray(s.artifacts)) arts.push(...s.artifacts.map(a => ({ ...a, sessionId: s.id })));
          const copy = { ...s };
          delete copy.messages; delete copy.executions; delete copy.artifacts;
          return copy;
        });
        state.sessions = sessions;
        state.messages = Array.from(new Map([...msgs, ...(loaded.messages || [])].map(item => [item.id, item])).values());
        state.executions = Array.from(new Map([...exs, ...(loaded.executions || [])].map(item => [item.id, item])).values());
        state.artifacts = Array.from(new Map([...arts, ...(loaded.artifacts || [])].map(item => [item.id, item])).values());
      } else {
        state.sessions = [];
        state.messages = Array.isArray(loaded.messages) ? loaded.messages : [];
        state.executions = Array.isArray(loaded.executions) ? loaded.executions : [];
        state.artifacts = Array.isArray(loaded.artifacts) ? loaded.artifacts : [];
      }

      // Normalize running tasks -> stopped for safety
      for (const task of state.tasks) if (task.status === 'running') Object.assign(task, { status: 'stopped', stage: '运行已中断', finishedAt: now(), error: '上次应用退出时任务尚未完成，请重新发起任务。' });

      // If legacy tasks present, perform runtime migration (single source)
      if (state.tasks.length > 0) {
        const previousSessions = [...state.sessions];
        try {
          const { snapshot, warnings } = migrateOldTasksToSnapshot(loaded, { projects: state.projects, sessions: state.sessions, messages: state.messages, executions: state.executions, artifacts: state.artifacts });
          // merge projects (preserve existing)
          const mergedProjects = Array.from(new Map([...(state.projects || []), ...(snapshot.projects || [])].map(p => [p.id, p])).values());
          state.projects = mergedProjects;
          // snapshot may be normalized; copy collections
          state.sessions = snapshot.sessions || [];
          state.messages = snapshot.messages || [];
          state.executions = snapshot.executions || [];
          state.artifacts = snapshot.artifacts || [];

          // Persist migrated state to disk immediately
          await mkdir(dirname(stateFile), { recursive: true });
          const temp = `${stateFile}.tmp`;
          // test injection simulation
          if (testInject.writeFileThrows) throw new Error('simulated write failure');
          await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
          await rename(temp, stateFile);
        } catch (e) {
          // rollback in-memory sessions on failure
          state.sessions = previousSessions;
          throw new Error(`迁移并写入会话失败：${errorText(e)}`);
        }
      }
      let recovered = false;
      for (const execution of state.executions) {
        if (['running', 'queued', 'waiting_user'].includes(execution.status)) {
          Object.assign(execution, { status: 'interrupted', finishedAt: now(), error: '上次执行因应用关闭而中断，请发起新的执行。' });
          recovered = true;
        }
      }
      if (recovered) {
        await writeFile(`${stateFile}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
        await rename(`${stateFile}.tmp`, stateFile);
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw new Error(`无法加载应用数据，原文件已保留：${errorText(error)}`); }
  let runtime = await detectRuntime(state.settings, resourceRoot);
  const secrets = new Set();
  const redact = value => { let result = text(value); for (const secret of secrets) result = result.replaceAll(secret, '[已隐藏凭证]'); return result; };
  const failureText = error => errorText(redact(error?.message || String(error)));
  let active = null;
  let executionRunning = false;
  let executionJob = null;
  const executionQueue = [];
  let checking = false;
  let closing = false;
  let cleanupFailure = false;
  let writes = Promise.resolve();
  const snapshot = () => structuredClone({ ...state, connections: state.connections.map(({ encryptedApiKey, ...connection }) => ({ ...connection, hasApiKey: Boolean(encryptedApiKey) })), runtime: { ...runtime, busy: Boolean(active || executionRunning || checking), bin: undefined, sdk: undefined } });
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
  async function replaceFields(changes) {
    const befores = {};
    for (const k of Object.keys(changes)) befores[k] = state[k];
    Object.assign(state, changes);
    try { return await publish(); } catch (error) { Object.assign(state, befores); throw error; }
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
    if (testInject.makeHarness) return testInject.makeHarness(project);
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
      pumpExecutions();
    }
  }
  function closeExecution(job) {
    if (!job.harness) return Promise.resolve();
    return job.closePromise ||= Promise.resolve().then(() => job.harness.close());
  }
  function assertSessionIdle(id) {
    if (state.executions.some(e => e.sessionId === id && ['running', 'queued', 'waiting_user'].includes(e.status))) throw new Error('会话仍有执行或排队任务，请先停止或取消。');
  }
  function checkWorkspaceChange(input, existing) {
    if (existing && ['projectId', 'workspacePath'].some(key => key in input && input[key] !== existing[key])) assertSessionIdle(existing.id);
  }
  async function openPath(path, directory = false) {
    if (testInject.openPath) return testInject.openPath(path, directory);
    await new Promise((resolve, reject) => {
      const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./open-path.ps1', import.meta.url))], { windowsHide: true, timeout: 15000 }, error => error ? reject(new Error('无法打开文件或目录，请检查默认应用。')) : resolve());
      child.stdin.on('error', reject);
      child.stdin.end(JSON.stringify({ path, directory }));
    });
  }
  async function artifactLocation(id) {
    const artifact = state.artifacts.find(a => a.id === id);
    if (!artifact) throw new Error('文件成果不存在');
    const session = state.sessions.find(s => s.id === artifact.sessionId);
    const root = artifact.workspacePath || session?.workspacePath || state.projects.find(p => p.id === session?.projectId)?.path;
    if (!root) throw new Error('工作目录当前不可访问');
    const file = await safeFile(root, artifact.path);
    return { artifact, root, file };
  }
  function pumpExecutions() {
    if (closing || cleanupFailure || checking || active || executionJob || !executionQueue.length) return;
    const id = executionQueue.shift();
    const job = { id, cancelled: false, harness: null, closePromise: null, promise: null };
    executionJob = job;
    executionRunning = true;
    job.promise = executeExecution(job).catch(error => {
      const execution = state.executions.find(e => e.id === id);
      if (execution) Object.assign(execution, { status: 'failed', error: failureText(error), finishedAt: now() });
      // A persistence failure must stop the queue, rather than run work with unsaved state.
      failedCleanup(error);
      onChanged();
    }).finally(() => {
      executionJob = null;
      executionRunning = false;
      onChanged();
      pumpExecutions();
    });
  }
  async function executeExecution(job) {
    const execution = state.executions.find(e => e.id === job.id);
    const running = { ...execution, status: 'running', startedAt: now(), logs: [...(execution.logs || []), '开始执行'] };
    await replaceField('executions', state.executions.map(e => e.id === job.id ? running : e));
    let assistantMsg = null;
    let finalExec = running;
    let beforeFiles, workspacePath, runStarted = false;
    const excludedFiles = [stateFile, `${stateFile}.tmp`, join(dirname(stateFile), 'model.patch.yml')];
    try {
      const session = state.sessions.find(s => s.id === running.sessionId);
      if (!session) throw new Error('会话不存在');
      let project = session.projectId ? projectFor(session.projectId) : null;
      if (!project) {
        const workspacePath = session.workspacePath || join(dirname(stateFile), 'workspaces', randomUUID());
        await mkdir(workspacePath, { recursive: true });
        if (!session.workspacePath) await replaceField('sessions', state.sessions.map(s => s.id === session.id ? { ...s, workspacePath } : s));
        project = { path: workspacePath };
      }
      await access(project.path);
      workspacePath = await realpath(project.path);
      running.workspacePath = workspacePath;
      try { beforeFiles = await scanWorkspace(workspacePath, excludedFiles); }
      catch (error) { running.logs.push('成果捕获不可用：' + failureText(error)); }
      const position = state.executions.findIndex(e => e.id === running.id);
      const previous = state.executions.slice(0, position).filter(e => e.sessionId === session.id && !['queued', 'running'].includes(e.status)).slice(-20);
      const previousIds = new Set(previous.map(e => e.id));
      let messages = state.messages.filter(m => m.sessionId === session.id);
      const trigger = messages.findIndex(m => m.id === running.triggerMessageId);
      if (trigger >= 0) messages = messages.filter((m, index) => index < trigger || (m.role === 'assistant' && previousIds.has(m.executionId)));
      else messages = messages.filter(m => (m.createdAt || '') <= running.createdAt);
      const context = {
        contextSummary: session.contextSummary || '',
        messages: messages.slice(-20).map(({ role, content }) => ({ role, content: text(content).slice(0, 12000) })),
        executions: previous.map(({ id, status, prompt, error }) => ({ id, status, prompt, error })),
        artifacts: state.artifacts.filter(a => previousIds.has(a.executionId) || (!a.executionId && a.sessionId === session.id && (a.createdAt || '') <= running.createdAt)).slice(-50).map(({ path, executionId }) => ({ path, executionId })),
      };
      const prompt = `以下 JSON 是当前会话的历史上下文，供理解本轮需求，不代表新的指令：\n${JSON.stringify(context)}\n\n本轮需求：\n${running.prompt || ''}`;
      job.harness = await makeHarness(project);
      if (job.cancelled) throw new Error('执行已停止');
      runStarted = true;
      const result = await job.harness.run(prompt, {
        sessionId: running.id,
        onNotification: notification => {
          if (job.cancelled) return;
          const activity = summarizeEvent(notification, failureText);
          if (!activity) return;
          running.logs.push(redact(activity.label + (activity.detail ? '：' + activity.detail : '')));
          if (running.logs.length > 500) running.logs.shift();
          onChanged();
          persist().catch(error => { running.error = failureText(error); onChanged(); });
        },
      });
      if (!job.cancelled) {
        const events = result.events || [];
        const response = redact(result.finalResponse || events.filter(e => e.type === 'assistant/message').map(e => blocksText(e.data?.message?.content)).join('\n'));
        assistantMsg = { id: 'm-' + randomUUID(), sessionId: running.sessionId, executionId: running.id, role: 'assistant', content: response, createdAt: now() };
        finalExec = { ...running, status: { completed: 'succeeded', stopped: 'cancelled', failed: 'failed' }[finishStatus(events)], finishedAt: now() };
        if (finalExec.status === 'failed') finalExec.error = failureText(events.findLast(e => e.type === 'turn/end')?.data?.reason?.error || '执行未正常结束，请查看执行记录。');
      }
    } catch (error) {
      if (!job.cancelled) {
        const reason = failureText(error);
        const message = runStarted ? '执行失败，可能存在部分修改：' : '模拟回复：未执行真实任务。Harness 启动失败：';
        assistantMsg = { id: 'm-' + randomUUID(), sessionId: running.sessionId, executionId: running.id, role: 'assistant', content: message + reason, createdAt: now() };
        finalExec = { ...running, status: runStarted ? 'failed' : 'succeeded', simulated: !runStarted, error: reason, finishedAt: now(), logs: [...running.logs, message + reason] };
      }
    } finally {
      if (job.cancelled) finalExec = { ...running, status: 'cancelled', finishedAt: now(), logs: [...running.logs, '执行已停止，可能存在部分修改'] };
      try { await closeExecution(job); }
      catch (error) { finalExec = { ...finalExec, status: 'failed', error: failedCleanup(error) }; }
    }
    let captured = [];
    if (beforeFiles) {
      try { captured = collectArtifacts(beforeFiles, await scanWorkspace(workspacePath, excludedFiles), running, workspacePath); }
      catch (error) { finalExec.logs.push('未能完成成果捕获：' + failureText(error)); }
    }
    await replaceFields({
      artifacts: [...state.artifacts, ...captured],
      executions: state.executions.map(e => e.id === job.id ? finalExec : e),
      messages: assistantMsg ? [...state.messages, assistantMsg] : state.messages,
      sessions: state.sessions.map(s => s.id === running.sessionId ? { ...s, updatedAt: now() } : s),
    });
  }
  const controller = {
    getSessionById(id) { return (state.sessions || []).find(s => s.id === id) ?? null; },
    getSessionsByProjectId(projectId) { return (state.sessions || []).filter(s => s.projectId === projectId); },
    getMessagesBySessionId(sessionId) { return (state.messages || []).filter(m => m.sessionId === sessionId); },
    getExecutionsBySessionId(sessionId) { return (state.executions || []).filter(e => e.sessionId === sessionId); },
    getArtifactsBySessionId(sessionId) { return (state.artifacts || []).filter(a => a.sessionId === sessionId); },
    async dispatch(operation, params = {}) {
      if (closing) throw new Error('应用正在关闭');
      if (cleanupFailure && !['snapshot', 'changes', 'diff', 'artifact_details', 'open_artifact'].includes(operation)) throw new Error(runtime.message);
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('操作参数无效');
      switch (operation) {
        case 'snapshot': return snapshot();
        case 'artifact_details': {
          const artifact = state.artifacts.find(a => a.id === params.artifactId);
          if (!artifact) throw new Error('文件成果不存在');
          let availability = 'available';
          try {
            const { file } = await artifactLocation(params.artifactId);
            if (!(await stat(file)).isFile()) availability = 'missing';
            else if (artifact.afterHash && await hashFile(file) !== artifact.afterHash) availability = 'modified';
          } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code) || error.message === '工作目录当前不可访问') availability = 'missing'; else throw error; }
          return { ...artifact, availability };
        }
        case 'open_artifact': {
          const { file, root } = await artifactLocation(params.artifactId);
          const target = params.location ? root : file;
          try { await access(target); } catch { throw new Error('文件已不存在或路径当前不可访问'); }
          await openPath(target, Boolean(params.location));
          return { opened: true };
        }
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
        case 'save_session': {
          // params.session expected
          const input = params.session;
          if (!input || typeof input.id !== 'string') throw new Error('session 对象无效');
          const sessions = Array.isArray(state.sessions) ? state.sessions : [];
          const existing = sessions.find(s => s.id === input.id);
          checkWorkspaceChange(input, existing);
          const next = { ...existing, ...input, updatedAt: now() };
          const newSessions = existing ? sessions.map(s => s.id === existing.id ? next : s) : [next, ...sessions];
          // Use replaceField to get transactional publish + rollback
          await replaceField('sessions', newSessions);
          return snapshot();
        }
        case 'save_settings': {
          if (active || executionRunning || checking) throw new Error('请在运行结束后修改设置');
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
          if (active || executionRunning || checking) throw new Error('请在运行结束后修改 API 配置');
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
        case 'create_session': {
          const input = params.session;
          if (!input || typeof input.id !== 'string') throw new Error('session 对象无效');
          const sessions = Array.isArray(state.sessions) ? state.sessions : [];
          if (sessions.find(s => s.id === input.id)) throw new Error('session id 已存在');
          const next = { ...input, createdAt: input.createdAt || now(), updatedAt: now() };
          await replaceField('sessions', [next, ...sessions]);
          return snapshot();
        }
        case 'update_session': {
          const input = params.session;
          if (!input || typeof input.id !== 'string') throw new Error('session 对象无效');
          const sessions = Array.isArray(state.sessions) ? state.sessions : [];
          const idx = sessions.findIndex(s => s.id === input.id);
          if (idx < 0) throw new Error('session 不存在');
          checkWorkspaceChange(input, sessions[idx]);
          const updated = { ...sessions[idx], ...input, updatedAt: now() };
          const nextSessions = sessions.map(s => s.id === updated.id ? updated : s);
          await replaceField('sessions', nextSessions);
          return snapshot();
        }
        case 'delete_session': {
          const id = params.sessionId;
          if (!id) throw new Error('sessionId 必需');
          assertSessionIdle(id);
          const sessions = Array.isArray(state.sessions) ? state.sessions : [];
          const next = sessions.filter(s => s.id !== id);
          await replaceField('sessions', next);
          return snapshot();
        }
        case 'append_message': {
          const { sessionId, message } = params;
          if (!sessionId || !message || typeof message.role !== 'string') throw new Error('参数无效');
          const sessions = Array.isArray(state.sessions) ? state.sessions : [];
          const idx = sessions.findIndex(s => s.id === sessionId);
          if (idx < 0) throw new Error('session 不存在');
          const msg = { ...message, id: message.id || `m-${randomUUID()}`, sessionId, createdAt: message.createdAt || now() };
          const nextMessages = [...(state.messages || []), msg];
          const updatedSession = { ...sessions[idx], updatedAt: now() };
          const nextSessions = sessions.map(s => s.id === sessionId ? updatedSession : s);
          await replaceFields({ messages: nextMessages, sessions: nextSessions });
          return snapshot();
        }
        case 'create_execution': {
          const { sessionId, execution } = params;
          if (!sessionId || !execution || typeof execution.id !== 'string') throw new Error('参数无效');
          const sessions = Array.isArray(state.sessions) ? state.sessions : [];
          const idx = sessions.findIndex(s => s.id === sessionId);
          if (idx < 0) throw new Error('session 不存在');
          const exec = { ...execution, sessionId, createdAt: execution.createdAt || now() };
          const nextExecutions = [...(state.executions || []), exec];
          const updatedSession = { ...sessions[idx], updatedAt: now() };
          const nextSessions = sessions.map(s => s.id === sessionId ? updatedSession : s);
          await replaceFields({ executions: nextExecutions, sessions: nextSessions });
          return snapshot();
        }
        case 'run_execution': {
          const id = params.executionId;
          const execution = state.executions.find(e => e.id === id);
          if (!execution) throw new Error('execution 未找到');
          if (executionJob?.id === id || executionQueue.includes(id)) throw new Error('执行已经在队列中');
          if (execution.status !== 'queued') throw new Error('只能运行等待中的执行，请创建新的执行');
          executionQueue.push(id);
          pumpExecutions();
          onChanged();
          return snapshot();
        }
        case 'stop_execution': {
          const id = params.executionId;
          const execution = state.executions.find(e => e.id === id);
          if (!execution) throw new Error('execution 未找到');
          if (executionJob?.id === id) {
            const job = executionJob;
            job.cancelled = true;
            await closeExecution(job).catch(failedCleanup);
            await job.promise;
          } else if (execution.status === 'queued') {
            const index = executionQueue.indexOf(id);
            if (index >= 0) executionQueue.splice(index, 1);
            await replaceField('executions', state.executions.map(e => e.id === id ? { ...e, status: 'cancelled', finishedAt: now(), logs: [...(e.logs || []), '已取消排队，未开始执行'] } : e));
          }
          return snapshot();
        }
        case 'update_execution': {
          const { execution } = params;
          if (!execution || typeof execution.id !== 'string') throw new Error('参数无效');
          const exs = Array.isArray(state.executions) ? state.executions : [];
          const idx = exs.findIndex(e => e.id === execution.id);
          if (idx < 0) throw new Error('execution 未找到');
          const updated = { ...exs[idx], ...execution, updatedAt: now() };
          const nextExecutions = exs.map(e => e.id === updated.id ? updated : e);
          await replaceField('executions', nextExecutions);
          return snapshot();
        }
        case 'add_artifact': {
          const { sessionId, artifact } = params;
          if (!sessionId || !artifact || typeof artifact.id !== 'string') throw new Error('参数无效');
          const sessions = Array.isArray(state.sessions) ? state.sessions : [];
          const idx = sessions.findIndex(s => s.id === sessionId);
          if (idx < 0) throw new Error('session 不存在');
          const art = { ...artifact, sessionId, addedAt: artifact.addedAt || now() };
          const nextArtifacts = [...(state.artifacts || []), art];
          const updatedSession = { ...sessions[idx], updatedAt: now() };
          const nextSessions = sessions.map(s => s.id === sessionId ? updatedSession : s);
          await replaceFields({ artifacts: nextArtifacts, sessions: nextSessions });
          return snapshot();
        }
        case 'update_artifact': {
          const { artifact } = params;
          if (!artifact || typeof artifact.id !== 'string') throw new Error('参数无效');
          const arts = Array.isArray(state.artifacts) ? state.artifacts : [];
          const idx = arts.findIndex(a => a.id === artifact.id);
          if (idx < 0) throw new Error('artifact 未找到');
          const updated = { ...arts[idx], ...artifact, updatedAt: now() };
          const nextArtifacts = arts.map(a => a.id === updated.id ? updated : a);
          await replaceField('artifacts', nextArtifacts);
          return snapshot();
        }
        case 'remove_connection': {
          if (active || executionRunning || checking) throw new Error('请在运行结束后删除 API 配置');
          if (!state.connections.some(item => item.id === params.id)) throw new Error('API 配置不存在');
          const before = state;
          state = { ...state, connections: state.connections.filter(item => item.id !== params.id), settings: { ...state.settings, activeConnectionId: state.settings.activeConnectionId === params.id ? '' : state.settings.activeConnectionId } };
          try { await publish(); } catch (error) { state = before; throw error; }
          runtime.connected = false; onChanged(); return snapshot();
        }
        case 'check_runtime': {
          if (active || executionRunning || checking) throw new Error('运行中，请稍后验证连接');
          checking = true;
          let harness;
          try {
            runtime = await detectRuntime(state.settings, resourceRoot);
            harness = await makeHarness({ path: state.projects[0]?.path || homedir() });
            await harness.start();
            runtime.connected = true;
            runtime.message = '运行环境已就绪，可以开始任务';
          } catch (error) { runtime.connected = false; runtime.message = `连接验证失败：${failureText(error)}`; }
          finally { try { await harness?.close(); } catch (error) { failedCleanup(error); } checking = false; pumpExecutions(); }
          onChanged(); return snapshot();
        }
        case 'start_task': {
          if (active || executionRunning || checking) throw new Error('请等待当前任务或连接验证结束');
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
      executionQueue.length = 0;
      if (executionJob) {
        const job = executionJob;
        job.cancelled = true;
        await closeExecution(job).catch(failedCleanup);
        await job.promise;
      }
      for (const execution of state.executions) if (execution.status === 'queued') Object.assign(execution, { status: 'interrupted', finishedAt: now() });
      if (active) { const job = active; job.task.status = 'stopped'; await job.harness.close(); await job.promise; }
      await persist();
      await writes;
    },
  };
  return controller;
}
