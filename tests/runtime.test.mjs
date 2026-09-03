import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createController, summarizeEvent, finishStatus, safeFile } from '../runtime/core.mjs';

test('project state survives reload; duplicate canonical directories are not duplicated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-desktop-test-'));
  try {
    const project = join(root, 'project'); await mkdir(project);
    const file = join(root, 'state.json');
    const app = await createController({ stateFile: file });
    await app.dispatch('add_project', { path: project });
    await app.dispatch('add_project', { path: join(project, '.') });
    const fresh = await createController({ stateFile: file });
    const data = await fresh.dispatch('snapshot');
    assert.equal(data.projects.length, 1);
    assert.equal(data.projects[0].name, 'project');
    await assert.rejects(app.dispatch('add_project', { path: join(root, 'missing') }));
    await assert.rejects(app.dispatch('start_task', { projectId: data.projects[0].id, prompt: '  ' }), /目标/);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).projects.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('diff file validation rejects traversal, absolute paths and nested sibling tricks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-desktop-path-'));
  try {
    await writeFile(join(root, 'ok.txt'), 'ok');
    assert.equal(await safeFile(root, 'ok.txt'), await realpath(join(root, 'ok.txt')));
    await assert.rejects(safeFile(root, '../outside.txt'), /项目/);
    await assert.rejects(safeFile(root, join(root, 'ok.txt')), /相对/);
    await assert.rejects(safeFile(root, '.git/config'), /Git/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real event mapping never mistakes a failed or truncated turn for success', () => {
  assert.equal(finishStatus([{ type: 'turn/end', data: { reason: { kind: 'error' } } }]), 'failed');
  assert.equal(finishStatus([{ type: 'turn/end', data: { reason: { kind: 'max-tokens' } } }]), 'failed');
  assert.equal(finishStatus([{ type: 'turn/end', data: { reason: { kind: 'completed' } } }]), 'completed');
  assert.equal(finishStatus([]), 'failed');
  const event = summarizeEvent({ method: 'session.event', params: { event: { type: 'tool/call', data: { name: 'read_file' } } } });
  assert.equal(event.kind, 'tool');
  assert.match(event.label, /read_file/);
});

test('failed save leaves project state unchanged and resolved Git aliases are blocked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-desktop-save-'));
  try {
    const file = join(root, 'state.json');
    const app = await createController({ stateFile: file });
    await mkdir(file);
    await assert.rejects(app.dispatch('add_project', { path: root }));
    assert.equal((await app.dispatch('snapshot')).projects.length, 0);
    await mkdir(join(root, '.git')); await writeFile(join(root, '.git/config'), 'private');
    await symlink(join(root, '.git'), join(root, 'alias'), 'junction');
    await assert.rejects(safeFile(root, 'alias/config'), /Git/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Git review supports deleted parent directories, renames and nested projects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-desktop-git-'));
  const call = promisify(execFile);
  const git = (...args) => call('git', ['-C', root, ...args], { windowsHide: true });
  try {
    await git('init'); await mkdir(join(root, 'sub/gone'), { recursive: true });
    await writeFile(join(root, 'sub/gone/a.txt'), 'before\n');
    await writeFile(join(root, 'sub/old.txt'), 'hello world\n'); await writeFile(join(root, 'outside.txt'), 'before\n');
    await git('add', '.'); await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
    await rm(join(root, 'sub/gone'), { recursive: true });
    await git('mv', 'sub/old.txt', 'sub/new.txt');
    await writeFile(join(root, 'outside.txt'), 'outside changed\n');
    const app = await createController({ stateFile: join(root, 'app-state.json') });
    const data = await app.dispatch('add_project', { path: join(root, 'sub') });
    const projectId = data.projects[0].id;
    const changed = await app.dispatch('changes', { projectId });
    assert.deepEqual(changed.files.map(f => f.path).sort(), ['gone/a.txt', 'new.txt']);
    assert.match(await app.dispatch('diff', { projectId, path: 'gone/a.txt' }), /-before/);
    assert.match(await app.dispatch('diff', { projectId, path: 'new.txt' }), /rename from sub\/old.txt/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('child replies stay separate and a failed process cleanup blocks subsequent runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-desktop-sdk-'));
  let app;
  try {
    await mkdir(join(root, 'apps/cli/lib'), { recursive: true });
    await mkdir(join(root, 'packages/sdk/client/lib'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, 'apps/cli/package.json'), '{"name":"@deepseek-ai/dsh","version":"test"}');
    await writeFile(join(root, 'apps/cli/lib/bin.js'), '');
    await writeFile(join(root, 'packages/sdk/client/lib/index.js'), `export class DeepSeekHarness {
      async run(_, options) {
        for (const [sessionId, value] of [[options.sessionId, 'MAIN'], ['child', 'CHILD']]) {
          options.onNotification({method:'session.event', params:{sessionId, event:{type:'assistant/message', data:{message:{content:[{type:'text',text:value}]}}}}});
        }
        await new Promise(r=>setTimeout(r,40));
        return {events:[{type:'turn/end',data:{reason:{kind:'completed'}}}],finalResponse:'MAIN'};
      }
      async close() { throw new Error('cleanup did not confirm exit'); }
    }`);
    app = await createController({ stateFile: join(root, 'state.json') });
    await app.dispatch('save_settings', { settings: { harnessPath: root, provider: 'test', model: 'test' } });
    let state = await app.dispatch('add_project', { path: root });
    state = await app.dispatch('start_task', { projectId: state.projects[0].id, prompt: 'test' });
    assert.equal(state.tasks[0].response, 'MAIN');
    assert.ok(state.tasks[0].activities.some(a => a.label.startsWith('子任务：')));
    await new Promise(r => setTimeout(r,100));
    await assert.rejects(app.dispatch('start_task', { projectId: state.projects[0].id, prompt: 'again' }), /重新启动/);
  } finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }); }
});

test('an event queued during a failed save persists the rolled-back project state', { timeout: 5000 }, async () => {
  const fs = (await import('node:fs/promises')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const originalRename = fs.rename;
  const root = await mkdtemp(join(tmpdir(), 'harness-desktop-rollback-'));
  let app;
  try {
    await mkdir(join(root, 'apps/cli/lib'), { recursive: true });
    await mkdir(join(root, 'packages/sdk/client/lib'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, 'apps/cli/package.json'), '{"name":"@deepseek-ai/dsh","version":"test"}');
    await writeFile(join(root, 'apps/cli/lib/bin.js'), '');
    const sdkPath = join(root, 'packages/sdk/client/lib/index.js');
    await writeFile(sdkPath, `export let notify, finish;
      export class DeepSeekHarness {
        run(_, options) {
          notify = () => options.onNotification({method:'session.event',params:{sessionId:options.sessionId,event:{type:'tool/call',data:{name:'test'}}}});
          return new Promise(resolve => { finish = () => resolve({events:[{type:'turn/end',data:{reason:{kind:'completed'}}}],finalResponse:''}); });
        }
        async close() { finish?.(); }
      }`);
    const sdk = await import(pathToFileURL(sdkPath).href);
    const stateFile = join(root, 'state.json');
    app = await createController({ stateFile });
    await app.dispatch('save_settings', { settings: { harnessPath: root, provider: 'test', model: 'test' } });
    const state = await app.dispatch('add_project', { path: root });
    const running = await app.dispatch('start_task', { projectId: state.projects[0].id, prompt: 'test' });
    const secondProject = join(root, 'second'); await mkdir(secondProject);
    let failOnce = true, saved;
    const eventSaved = new Promise(resolve => { saved = resolve; });
    fs.rename = async (...args) => {
      if (failOnce) {
        failOnce = false;
        sdk.notify();
        throw Object.assign(new Error('transient write failure'), { code: 'EACCES' });
      }
      await originalRename(...args); saved();
    };
    syncBuiltinESMExports();
    await assert.rejects(app.dispatch('add_project', { path: secondProject }), { code: 'EACCES' });
    await eventSaved;
    assert.deepEqual((await app.dispatch('snapshot')).projects, running.projects);
    assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')).projects, running.projects);
  } finally {
    fs.rename = originalRename; syncBuiltinESMExports();
    await app?.close(); await rm(root, { recursive: true, force: true });
  }
});
