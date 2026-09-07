import test from 'node:test';
import fs from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { createController } from '../runtime/core.mjs';

function tmpDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'ds-test-')); }

async function writeState(file, obj) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(obj, null, 2)); }

async function readState(file) { const raw = await fs.readFile(file, 'utf8'); return JSON.parse(raw); }

export async function testStartupMigrationPersists() {
  const dir = await tmpDir();
  const stateFile = path.join(dir, 'state.json');
  const now = new Date().toISOString();
  const legacy = { projects: [], tasks: [{ id: 1, prompt: 'hello', status: 'completed', startedAt: now, finishedAt: now, response: 'ok', projectId: null }], settings: {} };
  await writeState(stateFile, legacy);
  const controller = await createController({ stateFile });
  // after migration, saved file should contain sessions and empty tasks
  const onDisk = await readState(stateFile);
  assert.equal(Array.isArray(onDisk.sessions), true, 'sessions present');
  assert.equal(onDisk.sessions.length, 1, 'one migrated session');
  assert.equal(Array.isArray(onDisk.tasks), true);
  assert.equal(onDisk.tasks.length, 1, 'legacy task remains available to existing UI');
}

export async function testSessionsOnlyLoad() {
  const dir = await tmpDir();
  const stateFile = path.join(dir, 'state.json');
  const snap = { sessions: [{ id: 's-1', title: 'S1' }], projects: [], settings: {} };
  await writeState(stateFile, snap);
  const controller = await createController({ stateFile });
  const snapshot = await controller.dispatch('snapshot');
  assert.equal(Array.isArray(snapshot.sessions), true);
  assert.equal(snapshot.sessions.length, 1);
}

export async function testWriteFailureRollback() {
  const dir = await tmpDir();
  const stateFile = path.join(dir, 'state.json');
  const legacy = { projects: [], tasks: [{ id: 2, prompt: 'fail', status: 'completed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), response: 'ok' }], settings: {} };
  await writeState(stateFile, legacy);
  try {
    await createController({ stateFile, _test_inject: { writeFileThrows: true } });
    throw new Error('expected migration to fail');
  } catch (e) {
    assert.ok(String(e).includes('迁移并写入会话失败'), 'migration failure reported');
  }
  const onDisk = await readState(stateFile);
  // ensure original tasks remain (no migration persisted)
  assert.equal(Array.isArray(onDisk.tasks), true);
  assert.equal(onDisk.tasks.length, 1);
}

export async function testSaveSessionPersists() {
  const dir = await tmpDir();
  const stateFile = path.join(dir, 'state.json');
  await writeState(stateFile, { projects: [], sessions: [], tasks: [], settings: {} });
  const controller = await createController({ stateFile });
  const session = { id: 's-save', title: 'Saved', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), projectId: null, messages: [], executions: [], artifacts: [], schemaVersion: 1 };
  await controller.dispatch('save_session', { session });
  const onDisk = await readState(stateFile);
  assert.equal(Array.isArray(onDisk.sessions), true);
  assert.equal(onDisk.sessions.find(s => s.id === 's-save') !== undefined, true);
}

export async function testDuplicateStartupIdempotent() {
  const dir = await tmpDir();
  const stateFile = path.join(dir, 'state.json');
  const now = new Date().toISOString();
  const legacy = { projects: [], tasks: [{ id: 3, prompt: 'idemp', status: 'completed', startedAt: now, finishedAt: now, response: 'ok' }], settings: {} };
  await writeState(stateFile, legacy);
  await createController({ stateFile });
  // second startup should not duplicate sessions
  await createController({ stateFile });
  const onDisk = await readState(stateFile);
  assert.equal(onDisk.sessions.length, 1, 'no duplicate sessions after repeated startup');
}

// Run tests when invoked directly

test('testStartupMigrationPersists', testStartupMigrationPersists);
test('testSessionsOnlyLoad', testSessionsOnlyLoad);
test('testWriteFailureRollback', testWriteFailureRollback);
test('testSaveSessionPersists', testSaveSessionPersists);
test('testDuplicateStartupIdempotent', testDuplicateStartupIdempotent);
