import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createController } from '../runtime/core.mjs';
import { migrateOldTasksToSnapshot } from '../runtime/migration.js';

test('migration keeps artifacts and logs and restores running legacy work as interrupted', () => {
  const existing = { projects: [], sessions: [], messages: [], executions: [], artifacts: [{ id: 'keep' }] };
  const legacy = { projects: [], tasks: [{ id: 'old', status: 'running', prompt: 'work', activities: [{ label: 'original log' }] }] };
  const { snapshot } = migrateOldTasksToSnapshot(legacy, existing);
  assert.deepEqual(snapshot.artifacts, existing.artifacts);
  assert.deepEqual(snapshot.executions[0].logs, ['original log']);
  assert.equal(snapshot.executions[0].status, 'interrupted');
  assert.deepEqual(migrateOldTasksToSnapshot({ projects: [], tasks: [] }, snapshot).snapshot, snapshot);
});

test('normalized history survives restart and unfinished executions become interrupted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-recovery-'));
  const stateFile = join(dir, 'state.json');
  await writeFile(stateFile, JSON.stringify({ sessions: [{ id: 's' }], messages: [{ id: 'm', sessionId: 's', content: 'keep' }], executions: [{ id: 'e', sessionId: 's', status: 'running' }], artifacts: [{ id: 'a', sessionId: 's', executionId: 'e', path: 'keep.txt' }] }));
  for (let i = 0; i < 2; i++) {
    const app = await createController({ stateFile });
    const snap = await app.dispatch('snapshot');
    assert.equal(snap.messages[0]?.content, 'keep');
    assert.equal(snap.artifacts[0]?.path, 'keep.txt');
    assert.equal(snap.executions[0]?.status, 'interrupted');
    await app.close();
  }
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).executions[0].status, 'interrupted');
});

test('runtime loads from isolated packaged resources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-package-'));
  await cp(new URL('../runtime/', import.meta.url), join(dir, 'runtime'), { recursive: true, filter: source => !source.includes('bundled') });
  const module = await import(pathToFileURL(join(dir, 'runtime/core.mjs')).href);
  assert.equal(typeof module.createController, 'function');
});
