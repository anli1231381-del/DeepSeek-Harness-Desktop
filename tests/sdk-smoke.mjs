import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createController } from '../runtime/core.mjs';

// Real local Harness + SDK, local simulated model response; no external API request.
const root = await mkdtemp(join(tmpdir(), 'harness-sdk-smoke-'));
let requests = 0;
let lastAuthorization;
let lastModel;
const server = createServer((request, response) => {
  let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => {
    lastAuthorization = request.headers.authorization;
    lastModel = JSON.parse(body).model;
    requests++;
    if (lastModel === 'error-test-model') { response.writeHead(401, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Rejected desktop-custom-test-key', type: 'authentication_error' } })); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    if (request.url.endsWith('/messages')) {
      assert.equal(request.url, '/v1/messages');
      lastAuthorization = request.headers['x-api-key'];
      event('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: lastModel, stop_reason: null, usage: { input_tokens: 3, output_tokens: 0 } } });
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '本地联通验证完成' } });
      event('content_block_stop', { index: 0 });
      event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } });
      event('message_stop', {}); response.end(); return;
    }
    if (request.url.endsWith('/responses')) {
      const item = { id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '本地联通验证完成', annotations: [] }] };
      event('response.created', { response: { id: 'resp_test', status: 'in_progress', output: [] } });
      event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: '本地联通验证完成' });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', { response: { id: 'resp_test', status: 'completed', output: [item], usage: { input_tokens: 3, output_tokens: 3, total_tokens: 6 } } });
      response.end(); return;
    }
    response.write('data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"content":"本地联通验证完成"}}]}\n\n');
    response.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":3}}\n\n');
    response.end('data: [DONE]\n\n');
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, { DEEPSEEK_API_KEY: 'local-smoke-dummy-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}`, DSH_HOME: join(root, 'dsh'), DSH_TELEMETRY_DISABLED: '1', DSH_PERMISSION_MODE: 'read-only' });
const project = join(root, 'project'); await mkdir(project);
const app = await createController({ stateFile: join(root, 'state.json') });
try {
  let snapshot = await app.dispatch('add_project', { path: project });
  const catalog = await app.dispatch('harness_catalog');
  assert.ok(catalog.providers.find(provider => provider.id === 'deepseek-official').models.some(model => model.id === 'deepseek-v4-pro'));
  const settingsFile = join(root, 'dsh/settings.yaml');
  await writeFile(settingsFile, JSON.stringify({ 'llm-pi-ai': { providers: { 'fixture-gateway': { api: 'openai-completions', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'TEST_ONLY_KEY', models: [{ id: 'configured-model-a' }, { id: 'configured-model-b' }] } } } }));
  const configured = await app.dispatch('harness_catalog');
  assert.deepEqual(configured.providers.find(provider => provider.id === 'fixture-gateway').models.map(model => model.id), ['configured-model-a', 'configured-model-b']);
  assert.equal(JSON.stringify(configured).includes('TEST_ONLY_KEY'), false);
  await unlink(settingsFile);
  snapshot = await app.dispatch('save_settings', { settings: { ...snapshot.settings, model: 'deepseek-v4-pro' } });
  snapshot = await app.dispatch('check_runtime');
  assert.equal(snapshot.runtime.connected, true, snapshot.runtime.message);
  console.log(`SDK handshake: ${snapshot.runtime.harnessVersion}`);
  snapshot = await app.dispatch('start_task', { projectId: snapshot.projects[0].id, prompt: '仅回复一句确认文字，不调用工具。' });
  const deadline = Date.now() + 60000;
  while ((snapshot.tasks[0].status === 'running' || snapshot.runtime.busy) && Date.now() < deadline) { await delay(200); snapshot = await app.dispatch('snapshot'); }
  assert.equal(snapshot.tasks[0].status, 'completed', snapshot.tasks[0].error || snapshot.tasks[0].stage);
  assert.equal(snapshot.tasks[0].response, '本地联通验证完成');
  assert.ok(requests > 0);
  assert.equal(lastModel, 'deepseek-v4-pro', 'The selected existing Harness model reaches the API');
  assert.ok(snapshot.tasks[0].activities.length > 1);
  for (const protocol of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
  snapshot = await app.dispatch('save_connection', { connection: { name: protocol, protocol, baseUrl: `http://127.0.0.1:${server.address().port}${protocol === 'anthropic-messages' ? '' : '/v1'}`, model: 'desktop-test-model', apiKey: 'desktop-custom-test-key' } });
  snapshot = await app.dispatch('save_settings', { settings: { ...snapshot.settings, activeConnectionId: snapshot.connections.at(-1).id } });
  snapshot = await app.dispatch('start_task', { projectId: snapshot.projects[0].id, prompt: '仅回复确认文字。' });
  const customDeadline = Date.now() + 60000;
  while ((snapshot.tasks[0].status === 'running' || snapshot.runtime.busy) && Date.now() < customDeadline) { await delay(200); snapshot = await app.dispatch('snapshot'); }
  assert.equal(snapshot.tasks[0].status, 'completed', snapshot.tasks[0].error || snapshot.tasks[0].stage);
  assert.equal(lastAuthorization, protocol === 'anthropic-messages' ? 'desktop-custom-test-key' : 'Bearer desktop-custom-test-key');
  assert.equal(lastModel, 'desktop-test-model');
  assert.equal(snapshot.tasks[0].response, '本地联通验证完成');
  assert.equal((await readFile(join(root, 'model.patch.yml'), 'utf8')).includes('desktop-custom-test-key'), false);
  console.log(`${protocol}: actual model/key routing PASS`);
  }
  snapshot = await app.dispatch('save_connection', { connection: { name: '错误脱敏测试', protocol: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'error-test-model', apiKey: 'desktop-custom-test-key' } });
  snapshot = await app.dispatch('save_settings', { settings: { ...snapshot.settings, activeConnectionId: snapshot.connections.at(-1).id } });
  snapshot = await app.dispatch('start_task', { projectId: snapshot.projects[0].id, prompt: '验证错误处理。' });
  const errorDeadline = Date.now() + 60000;
  while ((snapshot.tasks[0].status === 'running' || snapshot.runtime.busy) && Date.now() < errorDeadline) { await delay(200); snapshot = await app.dispatch('snapshot'); }
  assert.equal(snapshot.tasks[0].status, 'failed');
  assert.equal(JSON.stringify(snapshot).includes('desktop-custom-test-key'), false, 'API error must not reveal the key');
  assert.equal((await readFile(join(root, 'state.json'), 'utf8')).includes('desktop-custom-test-key'), false);
  console.log(`Task completed with ${snapshot.tasks[0].activities.length} activity records and ${requests} local model request(s).`);
} finally { await app.close(); await new Promise(resolve => server.close(resolve)); }
