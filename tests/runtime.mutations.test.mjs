import test from 'node:test';
import fs from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { createController } from '../runtime/core.mjs';

function tmpDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'ds-test-')); }
async function writeState(file, obj) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(obj, null, 2)); }
async function readState(file) { const raw = await fs.readFile(file, 'utf8'); return JSON.parse(raw); }

export async function testFullClosedLoop() {
  const dir = await tmpDir();
  const stateFile = path.join(dir, 'state.json');
  await writeState(stateFile, { projects: [], sessions: [], tasks: [], settings: {} });
  const c1 = await createController({ stateFile });

  // create session without project
  const session = { id: 's-closed', title: 'ClosedLoop', projectId: null, messages: [], executions: [], artifacts: [], schemaVersion: 1 };
  await c1.dispatch('create_session', { session });

  // append user message
  await c1.dispatch('append_message', { sessionId: 's-closed', message: { role: 'user', content: 'Hello' } });
  // append assistant message
  await c1.dispatch('append_message', { sessionId: 's-closed', message: { role: 'assistant', content: 'Hi' } });

  // create execution
  const exec = { id: 'e-1', triggerMessageId: null, status: 'queued', toolCalls: [], logs: [] };
  await c1.dispatch('create_execution', { sessionId: 's-closed', execution: exec });

  // update execution to running then succeeded
  await c1.dispatch('update_execution', { execution: { id: 'e-1', status: 'running', startedAt: new Date().toISOString() } });
  await c1.dispatch('update_execution', { execution: { id: 'e-1', status: 'succeeded', endedAt: new Date().toISOString() } });

  // add artifact
  const art = { id: 'a-1', changeType: 'created', diff: '++file', beforeHash: null, afterHash: 'abc123' };
  await c1.dispatch('add_artifact', { sessionId: 's-closed', artifact: art });

  // verify in memory
  const snap1 = await c1.dispatch('snapshot');
  const s = snap1.sessions.find(x => x.id === 's-closed');
  assert.ok(s, 'session present');
  const msgs = (snap1.messages || []).filter(m => m.sessionId === 's-closed');
  const exs = (snap1.executions || []).filter(e => e.sessionId === 's-closed');
  const arts = (snap1.artifacts || []).filter(a => a.sessionId === 's-closed');
  assert.equal(msgs.length, 2);
  assert.equal(exs.length, 1);
  assert.equal(exs[0].status, 'succeeded');
  assert.equal(arts.length, 1);

  // simulate restart
  const c2 = await createController({ stateFile });
  const snap2 = await c2.dispatch('snapshot');
  const s2 = snap2.sessions.find(x => x.id === 's-closed');
  assert.ok(s2, 'session restored after restart');
  const msgs2 = (snap2.messages || []).filter(m => m.sessionId === 's-closed');
  const exs2 = (snap2.executions || []).filter(e => e.sessionId === 's-closed');
  const arts2 = (snap2.artifacts || []).filter(a => a.sessionId === 's-closed');
  assert.equal(msgs2.length, 2);
  assert.equal(exs2.length, 1);
  assert.equal(exs2[0].status, 'succeeded');
  assert.equal(arts2.length, 1);
}


test('testFullClosedLoop', testFullClosedLoop);
