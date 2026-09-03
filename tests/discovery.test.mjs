import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createController } from '../runtime/core.mjs';
import { fetchModels } from '../runtime/discovery.mjs';
import { validateConnection } from '../runtime/connections.mjs';

test('official providers fetch their real catalog path and reject mismatched DeepSeek protocols', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    return new Response(JSON.stringify({ data: [{ id: 'first-model' }, { id: 'second-model' }] }));
  });
  for (const [baseUrl, protocol, endpoint, auth] of [
    ['https://api.deepseek.com', 'openai-completions', 'https://api.deepseek.com/models', 'Authorization'],
    ['https://api.deepseek.com/anthropic', 'anthropic-messages', 'https://api.deepseek.com/models', 'Authorization'],
    ['https://api.openai.com/v1', 'openai-responses', 'https://api.openai.com/v1/models', 'Authorization'],
    ['https://api.openai.com/v1', 'openai-completions', 'https://api.openai.com/v1/models', 'Authorization'],
    ['https://api.anthropic.com', 'anthropic-messages', 'https://api.anthropic.com/v1/models?limit=1000', 'x-api-key'],
  ]) {
    const result = await fetchModels({ baseUrl, protocol }, 'fixture-key');
    assert.equal(calls.at(-1).url, endpoint);
    assert.ok(calls.at(-1).headers[auth].endsWith('fixture-key'));
    assert.deepEqual(result.models.map(m => m.id), ['first-model', 'second-model']);
  }
  assert.throws(() => validateConnection({ name: 'DeepSeek', model: 'model', baseUrl: 'https://api.deepseek.com/anthropic', protocol: 'openai-completions' }), /Anthropic/);
});

test('model discovery uses the selected endpoint/protocol, preserves saved keys, and does not leak or redirect them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-discovery-'));
  const stateFile = join(root, 'state.json');
  const app = await createController({ stateFile });
  let calls = [];
  const server = createServer((req, res) => {
    calls.push({ url: req.url, auth: req.headers.authorization, key: req.headers['x-api-key'], version: req.headers['anthropic-version'] });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/reject')) { res.writeHead(401); res.end('{"error":"discovery-private-key"}'); }
    else if (req.url.startsWith('/redirect')) { res.writeHead(302, { Location: '/stolen' }); res.end(); }
    else if (req.url.startsWith('/invalid')) res.end('{"oops":true}');
    else if (req.url.startsWith('/anthropic/v1/models')) res.end(JSON.stringify({ data: [{ id: req.url.includes('after_id') ? 'model-2' : 'model-1', display_name: 'Available model' }], has_more: !req.url.includes('after_id'), last_id: 'model-1' }));
    else res.end(JSON.stringify({ data: [{ id: 'model-1' }, { id: 'model-2', name: 'Second model' }, { id: 'model-1' }, { id: '' }] }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const draft = { name: '', model: '', protocol: 'openai-completions', baseUrl: base + '/gateway/v1/', apiKey: 'discovery-private-key' };
  try {
    let result = await app.dispatch('api_models', { connection: draft });
    assert.deepEqual(result.models.map(m => m.id), ['model-1', 'model-2']);
    assert.equal(calls.at(-1).url, '/gateway/v1/models');
    assert.equal(calls.at(-1).auth, 'Bearer discovery-private-key');
    let snapshot = await app.dispatch('save_connection', { connection: { ...draft, name: 'Saved', model: 'model-1' } });
    const saved = snapshot.connections[0];
    await app.dispatch('api_models', { connection: { ...saved, apiKey: '' } });
    assert.equal(calls.at(-1).auth, 'Bearer discovery-private-key');
    const previousCalls = calls.length;
    await assert.rejects(app.dispatch('api_models', { connection: { ...saved, baseUrl: base + '/elsewhere', apiKey: '' } }), /重新填写密钥/);
    assert.equal(calls.length, previousCalls);
    result = await app.dispatch('api_models', { connection: { ...draft, protocol: 'anthropic-messages', baseUrl: base + '/anthropic' } });
    assert.deepEqual(result.models.map(m => m.id), ['model-1', 'model-2']);
    assert.equal(calls.at(-1).key, draft.apiKey);
    assert.equal(calls.at(-1).auth, undefined);
    assert.equal(calls.at(-1).version, '2023-06-01');
    for (const path of ['/reject', '/redirect', '/invalid']) {
      await assert.rejects(app.dispatch('api_models', { connection: { ...draft, baseUrl: base + path } }), error => !error.message.includes(draft.apiKey));
    }
    assert.equal(calls.some(c => c.url === '/stolen'), false);
    assert.equal((await readFile(stateFile, 'utf8')).includes(draft.apiKey), false);
  } finally { await app.close(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); }
});
