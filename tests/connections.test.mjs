import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createController } from '../runtime/core.mjs';

test('API connections validate endpoints, protect secrets, persist selection and require a new key for a changed endpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-connections-'));
  const stateFile = join(root, 'state.json');
  const app = await createController({ stateFile });
  const connection = { name: '测试网关', protocol: 'openai-completions', baseUrl: 'https://gateway.example/v1', model: 'test-model', apiKey: 'test-private-credential-123' };
  try {
    await assert.rejects(app.dispatch('save_connection', { connection: { ...connection, baseUrl: 'https://user:secret@gateway.example/v1' } }), /地址/);
    await assert.rejects(app.dispatch('save_connection', { connection: { ...connection, protocol: 'unknown' } }), /协议/);
    let snapshot = await app.dispatch('save_connection', { connection });
    const saved = snapshot.connections[0];
    assert.equal(saved.hasApiKey, true);
    assert.equal(JSON.stringify(snapshot).includes(connection.apiKey), false);
    assert.equal(JSON.stringify(snapshot).includes('encryptedApiKey'), false);
    assert.equal((await readFile(stateFile, 'utf8')).includes(connection.apiKey), false);
    snapshot = await app.dispatch('save_settings', { settings: { ...snapshot.settings, activeConnectionId: saved.id } });
    await app.dispatch('save_connection', { connection: { ...saved, name: '改名', apiKey: '' } });
    await assert.rejects(app.dispatch('save_connection', { connection: { ...saved, baseUrl: 'https://other.example/v1', apiKey: '' } }), /密钥/);
    const fresh = await createController({ stateFile });
    const loaded = await fresh.dispatch('snapshot');
    assert.equal(loaded.settings.activeConnectionId, saved.id);
    assert.equal(loaded.connections[0].name, '改名');
    assert.equal(loaded.connections[0].hasApiKey, true);
    await fresh.close();
    snapshot = await app.dispatch('remove_connection', { id: saved.id });
    assert.equal(snapshot.connections.length, 0);
    assert.equal(snapshot.settings.activeConnectionId, '');
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
