import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createController } from '../runtime/core.mjs';
import { until } from './wait-for-execution.mjs';

for (const mode of ['setup', 'partial', 'terminal']) test(`execution ${mode} failure is reported accurately`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-failure-'));
  const app = await createController({ stateFile: join(dir, 'state.json'), _test_inject: { makeHarness(project) {
    if (mode === 'setup') throw new Error('setup unavailable');
    return { async run() {
      if (mode === 'partial') { await writeFile(join(project.path, 'partial.txt'), 'partial work'); throw new Error('provider disconnected'); }
      return { events: [{ type: 'turn/end', data: { reason: { kind: 'failed', error: 'provider quota exceeded' } } }] };
    }, async close() {} };
  } } });
  try {
    await app.dispatch('create_session', { session: { id: 's', projectId: null } });
    await app.dispatch('create_execution', { sessionId: 's', execution: { id: 'e', status: 'queued', prompt: 'test' } });
    await app.dispatch('run_execution', { executionId: 'e' });
    const snapshot = await until(app, s => !s.runtime.busy && ['succeeded', 'failed'].includes(s.executions[0].status));
    const execution = snapshot.executions[0];
    assert.equal(execution.status, 'failed');
    assert.equal(Boolean(execution.simulated), mode === 'setup');
    if (mode === 'partial') assert.equal(snapshot.artifacts[0].path, 'partial.txt');
    if (mode === 'terminal') assert.match(execution.error, /quota exceeded/);
    const failed = execution.steps?.find(step => step.status === 'failed');
    assert.ok(failed, 'the failed stage must be recorded');
    assert.equal(failed.id, mode === 'setup' ? 'harness' : 'execute');
    assert.match(failed.detail, mode === 'setup' ? /setup unavailable/ : mode === 'partial' ? /provider disconnected/ : /quota exceeded/);
  } finally { await app.close(); }
});
