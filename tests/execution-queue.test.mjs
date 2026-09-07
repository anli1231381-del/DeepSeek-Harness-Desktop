import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createController } from '../runtime/core.mjs';

export async function until(app, predicate) {
  for (let i = 0; i < 200; i++) {
    const snapshot = await app.dispatch('snapshot');
    if (predicate(snapshot)) return snapshot;
    await delay(10);
  }
  throw new Error('execution state did not settle');
}

test('queued work returns promptly, runs serially, stops without simulation, and restores scoped context', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-queue-'));
  const stateFile = join(dir, 'state.json');
  const calls = [];
  let inFlight = 0, maximum = 0;
  const makeHarness = project => {
    let release;
    return {
      run(prompt) {
        calls.push({ prompt, path: project.path });
        maximum = Math.max(maximum, ++inFlight);
        return new Promise(resolve => { release = () => { inFlight--; resolve({ finalResponse: 'done', events: [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] }); }; });
      },
      async close() { release?.(); release = null; },
    };
  };
  let app = await createController({ stateFile, _test_inject: { makeHarness } });
  try {
    for (const id of ['a', 'b']) {
      await app.dispatch('save_session', { session: { id, projectId: null, contextSummary: 'summary-' + id } });
      await app.dispatch('append_message', { sessionId: id, message: { id: 'm-' + id, role: 'user', content: 'private-' + id } });
      await app.dispatch('create_execution', { sessionId: id, execution: { id, status: 'queued', prompt: 'next-' + id } });
    }
    const response = await Promise.race([app.dispatch('run_execution', { executionId: 'a' }), delay(1000).then(() => { throw new Error('run_execution blocks the bridge'); })]);
    assert.ok(response.executions.some(e => e.id === 'a'));
    await until(app, () => calls.length === 1);
    await app.dispatch('run_execution', { executionId: 'b' });
    assert.equal((await app.dispatch('snapshot')).executions.find(e => e.id === 'b').status, 'queued');
    await assert.rejects(app.dispatch('delete_session', { sessionId: 'b' }), /执行|排队/);
    await assert.rejects(app.dispatch('update_session', { session: { id: 'a', workspacePath: dir } }), /执行|排队/);
    await assert.rejects(app.dispatch('run_execution', { executionId: 'b' }), /已.*队列|已经/);
    await app.dispatch('stop_execution', { executionId: 'a' });
    await until(app, () => calls.length === 2);
    await app.dispatch('stop_execution', { executionId: 'b' });
    const stopped = await until(app, s => s.executions.every(e => e.status === 'cancelled') && !s.runtime.busy);
    assert.equal(stopped.messages.filter(m => m.role === 'assistant').length, 0);
    assert.equal(maximum, 1);
    assert.notEqual(calls[0].path, calls[1].path);
    assert.ok((await stat(calls[0].path)).isDirectory());
    assert.match(calls[0].prompt, /summary-a/);
    assert.doesNotMatch(calls[0].prompt, /private-b/);
    await app.dispatch('save_session', { session: { id: 'a', title: 'renamed' } });
    assert.equal((await app.dispatch('snapshot')).sessions.find(s => s.id === 'a').workspacePath, calls[0].path);
    await app.close();
    let restoredPrompt;
    app = await createController({ stateFile, _test_inject: { makeHarness: project => ({ async run(prompt) { restoredPrompt = prompt; assert.equal(project.path, calls[0].path); return { finalResponse: 'ok', events: [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] }; }, async close() {} }) } });
    await app.dispatch('create_execution', { sessionId: 'a', execution: { id: 'a2', status: 'queued', prompt: 'continue' } });
    await app.dispatch('run_execution', { executionId: 'a2' });
    await until(app, s => s.executions.find(e => e.id === 'a2').status === 'succeeded' && !s.runtime.busy);
    assert.match(restoredPrompt, /summary-a/);
    assert.match(restoredPrompt, /private-a/);
    assert.match(restoredPrompt, /cancelled/);
    assert.doesNotMatch(restoredPrompt, /private-b/);
  } finally { await app.close(); }
});

test('runtime verification releases queued work when the check finishes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-check-queue-'));
  let ready, calls = 0;
  const app = await createController({ stateFile: join(dir, 'state.json'), _test_inject: { makeHarness: () => ({
    start: () => new Promise(resolve => { ready = resolve; }),
    async run() { calls++; return { events: [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] }; },
    async close() {},
  }) } });
  try {
    await app.dispatch('create_session', { session: { id: 's', projectId: null } });
    await app.dispatch('create_execution', { sessionId: 's', execution: { id: 'e', status: 'queued', prompt: 'work' } });
    const check = app.dispatch('check_runtime');
    await until(app, () => Boolean(ready));
    await app.dispatch('run_execution', { executionId: 'e' });
    ready();
    await check;
    await until(app, s => s.executions[0].status === 'succeeded');
    assert.equal(calls, 1);
  } finally { ready?.(); await app.close(); }
});

test('same-session queued turn sees prior completed reply but not later queued prompts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-turns-'));
  const prompts = [];
  let finishFirst;
  const app = await createController({ stateFile: join(dir, 'state.json'), _test_inject: { makeHarness: () => ({
    async run(prompt) {
      prompts.push(prompt);
      if (prompts.length === 1) await new Promise(resolve => { finishFirst = resolve; });
      return { finalResponse: 'prior-answer', events: [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] };
    }, async close() { finishFirst?.(); },
  }) } });
  try {
    await app.dispatch('save_session', { session: { id: 's', projectId: null } });
    for (const id of ['one', 'two', 'three']) {
      await app.dispatch('append_message', { sessionId: 's', message: { id: 'm-' + id, role: 'user', content: 'request-' + id } });
      await app.dispatch('create_execution', { sessionId: 's', execution: { id, prompt: 'request-' + id, triggerMessageId: 'm-' + id, status: 'queued' } });
      await app.dispatch('run_execution', { executionId: id });
      if (id === 'one') await until(app, () => prompts.length === 1);
    }
    await app.dispatch('stop_execution', { executionId: 'three' });
    finishFirst();
    await until(app, s => s.executions.find(e => e.id === 'two').status === 'succeeded' && !s.runtime.busy);
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /prior-answer/);
    assert.doesNotMatch(prompts[1], /request-three/);
  } finally { await app.close(); }
});
