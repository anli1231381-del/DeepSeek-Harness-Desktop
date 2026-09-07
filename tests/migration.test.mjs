import assert from 'assert';
import { migrateOldTasksToSnapshot } from '../runtime/migration.js';

// Ensure running under Node's test runner; basic smoke tests

const legacy = {
  projects: [{ id: 'p1', name: 'Proj', path: '/tmp/proj', updatedAt: new Date().toISOString() }],
  tasks: [{ id: 't1', projectId: 'p1', prompt: 'Hello', status: 'completed', startedAt: '2020-01-01T00:00:00.000Z', finishedAt: '2020-01-01T00:00:01.000Z', stage: 'done', activities: [], response: 'OK' }]
};

// First migration
const { snapshot, warnings } = migrateOldTasksToSnapshot(legacy, null);
assert.equal(warnings.length, 0);
assert.equal(Array.isArray(snapshot.sessions), true);
assert.equal(snapshot.sessions.length, 1, 'should create one session from one task');
assert.equal(snapshot.sessions[0].legacySourceId, 'task:t1');

// Idempotent merge: migrate again with existing snapshot should not duplicate
const second = migrateOldTasksToSnapshot(legacy, snapshot);
assert.equal(second.snapshot.sessions.length, 1, 'second migration should not duplicate sessions');

console.log('migration tests passed');
