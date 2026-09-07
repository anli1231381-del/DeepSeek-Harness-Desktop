import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createController } from '../runtime/core.mjs';
import { until } from './wait-for-execution.mjs';

test('captures only this execution changes and opens original artifact locations safely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-artifacts-'));
  const project = join(dir, 'project');
  await mkdir(project);
  await writeFile(join(project, 'unchanged.txt'), 'pre-existing user change');
  await writeFile(join(project, 'changed.txt'), 'before\n');
  await writeFile(join(project, 'deleted.bin'), Buffer.from([0, 1, 2]));
  const opened = [];
  const app = await createController({ stateFile: join(dir, 'state.json'), _test_inject: {
    openPath: async (...args) => opened.push(args),
    makeHarness: () => ({ async run() {
      await writeFile(join(project, 'changed.txt'), 'after\n');
      await writeFile(join(project, 'created.txt'), 'new\n');
      await unlink(join(project, 'deleted.bin'));
      return { finalResponse: 'done', events: [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] };
    }, async close() {} }),
  } });
  try {
    const added = await app.dispatch('add_project', { path: project });
    await app.dispatch('create_session', { session: { id: 's', projectId: added.projects[0].id } });
    await app.dispatch('create_execution', { sessionId: 's', execution: { id: 'e', status: 'queued', prompt: 'edit' } });
    await app.dispatch('run_execution', { executionId: 'e' });
    const snapshot = await until(app, s => s.executions[0].status === 'succeeded' && !s.runtime.busy);
    assert.deepEqual(snapshot.artifacts.map(a => [a.path, a.changeType]).sort(), [['changed.txt', 'modified'], ['created.txt', 'created'], ['deleted.bin', 'deleted']]);
    const changed = snapshot.artifacts.find(a => a.path === 'changed.txt');
    assert.match(changed.diff, /-before/);
    assert.match(changed.diff, /\+after/);
    await app.dispatch('save_session', { session: { id: 's', projectId: null } });
    await app.dispatch('open_artifact', { artifactId: changed.id });
    assert.equal(opened[0][0], join(project, 'changed.txt'));
    await writeFile(join(project, 'changed.txt'), 'later edit');
    assert.equal((await app.dispatch('artifact_details', { artifactId: changed.id })).availability, 'modified');
    const deleted = snapshot.artifacts.find(a => a.changeType === 'deleted');
    await assert.rejects(app.dispatch('open_artifact', { artifactId: deleted.id }), /不存在/);
    await app.dispatch('open_artifact', { artifactId: deleted.id, location: true });
    assert.equal(opened.at(-1)[0], project);
    await app.dispatch('add_artifact', { sessionId: 's', artifact: { id: 'bad', executionId: 'e', path: '../state.json', workspacePath: project } });
    await assert.rejects(app.dispatch('open_artifact', { artifactId: 'bad' }), /超出/);
    await rename(project, project + '-moved');
    const missing = await app.dispatch('artifact_details', { artifactId: changed.id });
    assert.equal(missing.availability, 'missing');
    assert.equal(missing.diff, changed.diff);
  } finally { await app.close(); }
});
