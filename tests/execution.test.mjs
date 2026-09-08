import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createController } from '../runtime/core.mjs';
import { until } from './wait-for-execution.mjs';

test('Harness streams progress, maps success, closes on failure and labels simulation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-execution-'));
  let app, closed = 0, fail = false;
  app = await createController({ stateFile: join(dir, 'state.json'), _test_inject: { makeHarness: () => ({
    async run(prompt, { onNotification }) {
      if (fail) throw new Error('test failure');
      onNotification({ method: 'session.event', params: { sessionId: 'e1', event: { type: 'tool/call', data: { name: 'read_file' } } } });
      const snap = await app.dispatch('snapshot');
      assert.equal(snap.executions[0].status, 'running');
      assert.ok(snap.executions[0].logs.some(line => line.includes('读取文件')));
      return { finalResponse: 'done', events: [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] };
    }, async close() { closed++; },
  }) } });
  const added = await app.dispatch('add_project', { path: dir });
  await app.dispatch('save_session', { session: { id: 's', projectId: added.projects[0].id } });
  for (const id of ['e1', 'e2']) {
    await app.dispatch('create_execution', { sessionId: 's', execution: { id, prompt: 'test', status: 'queued' } });
    await app.dispatch('run_execution', { executionId: id });
    const snap = await until(app, s => s.executions.find(e => e.id === id).status === (fail ? 'failed' : 'succeeded') && !s.runtime.busy);
    assert.equal(snap.executions.find(e => e.id === id).status, fail ? 'failed' : 'succeeded');
    assert.equal(snap.artifacts.length, 0);
    if (fail) assert.match(snap.messages.at(-1).content, /执行失败.*可能存在部分修改/);
    else assert.equal(snap.messages.at(-1).content, 'done');
    fail = true;
  }
  assert.equal(closed, 2);
  await app.close();
});
