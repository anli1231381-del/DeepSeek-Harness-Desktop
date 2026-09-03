import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 680 } });
  await page.addInitScript(() => {
    window.isTauri = true;
    const state = { projects: [], tasks: [], connections: [], settings: { harnessPath: '', provider: 'deepseek-official', model: 'deepseek-v4-flash', activeConnectionId: '' }, runtime: { available: true, connected: false, busy: localStorage.getItem('fixture-busy') === 'true', nodeVersion: 'v24', source: 'bundled', message: '已检测' } };
    window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command, { operation, params } = {}) => {
      if (command !== 'bridge') return 1;
      if (operation === 'save_connection') { state.connections = [{ ...params.connection, apiKey: undefined, hasApiKey: true, id: 'test' }]; }
      if (operation === 'api_models') {
        if (params.connection.apiKey === 'slow-fixture') {
          await new Promise(resolve => { window.finishOldCatalog = resolve; });
          return { models: [{ id: 'stale-model' }], message: '旧请求已完成' };
        }
        if (params.connection.baseUrl.endsWith('/unavailable')) throw new Error('此 API 未提供模型列表接口，请手动填写模型 ID。');
        return { models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }], message: '已获取 2 个模型' };
      }
      if (operation === 'harness_catalog') return { providers: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] }], message: '已检测到 1 个服务商' };
      if (operation === 'save_settings') state.settings = params.settings;
      return structuredClone(state);
    } };
  });
  await page.goto('http://127.0.0.1:1420');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '设置', exact: true }).click();
  const add = page.getByRole('button', { name: '添加 API', exact: true });
  await add.click();
  console.log(await page.locator('.connection-editor').evaluate(e => ({ top: e.getBoundingClientRect().top, viewport: innerHeight, focused: e.contains(document.activeElement) })));
  assert.equal(await page.getByRole('dialog', { name: '添加 API', exact: true }).count(), 1);
  assert.equal(await page.locator('.connection-editor').evaluate(e => e.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  assert.equal(await add.evaluate(e => e === document.activeElement), true);
  await add.click();
  for (const [provider, address, protocol] of [
    ['openai', 'https://api.openai.com/v1', 'openai-responses'],
    ['anthropic', 'https://api.anthropic.com', 'anthropic-messages'],
    ['deepseek', 'https://api.deepseek.com', 'openai-completions'],
  ]) {
    await page.getByLabel('服务商', { exact: true }).selectOption(provider);
    assert.equal(await page.getByLabel('API 地址', { exact: true }).inputValue(), address, 'Preset must fill the value, not just the placeholder');
    assert.equal(await page.getByLabel('接口协议', { exact: true }).inputValue(), protocol);
    await page.getByLabel('API 密钥', { exact: true }).fill('test-only');
    await page.getByLabel('模型名称', { exact: true }).selectOption('model-b');
    await page.getByRole('button', { name: '保存 API', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('bridge', { operation: 'snapshot' }));
    assert.equal(saved.connections[0].baseUrl, address);
    assert.equal(saved.connections[0].protocol, protocol);
    assert.equal(saved.connections[0].model, 'model-b');
    await page.getByRole('button', { name: `编辑 ${saved.connections[0].name}`, exact: true }).click();
    assert.equal(await page.getByLabel('服务商', { exact: true }).inputValue(), provider);
    await page.getByLabel('模型名称', { exact: true }).selectOption('model-a');
    await page.getByRole('button', { name: '保存 API', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const switched = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('bridge', { operation: 'snapshot' }));
    assert.equal(switched.connections[0].model, 'model-a');
    await add.click();
  }
  await page.getByLabel('接口协议', { exact: true }).selectOption('anthropic-messages');
  assert.equal(await page.getByLabel('API 地址', { exact: true }).inputValue(), 'https://api.deepseek.com/anthropic');
  await page.getByLabel('接口协议', { exact: true }).selectOption('openai-completions');
  assert.equal(await page.getByLabel('API 地址', { exact: true }).inputValue(), 'https://api.deepseek.com');
  await page.getByLabel('API 密钥', { exact: true }).fill('test-only');
  await page.getByLabel('模型名称', { exact: true }).selectOption('model-b');
  await page.screenshot({ path: 'test-results/api-dialog.png' });
  await page.getByRole('button', { name: '保存 API', exact: true }).click();
  await page.locator('.connection-row').filter({ hasText: 'model-b' }).waitFor();
  await page.getByRole('button', { name: '检测已有配置', exact: true }).click();
  await page.getByLabel('Harness 模型', { exact: true }).selectOption('deepseek-v4-pro');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  const state = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('bridge', { operation: 'snapshot' }));
  assert.equal(state.settings.model, 'deepseek-v4-pro');
  await add.click();
  await page.getByLabel('服务商', { exact: true }).selectOption('custom');
  await page.getByLabel('配置名称', { exact: true }).fill('手填模型测试');
  await page.getByLabel('API 地址', { exact: true }).fill('https://example.invalid/unavailable');
  await page.getByRole('button', { name: '获取模型', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '此 API 未提供模型列表接口' }).waitFor();
  await page.getByLabel('模型名称', { exact: true }).selectOption('__custom__');
  await page.getByLabel('模型名称（自定义 ID）', { exact: true }).fill('manual-model');
  await page.getByRole('button', { name: '保存 API', exact: true }).click();
  await page.locator('.connection-row').filter({ hasText: 'manual-model' }).waitFor();
  await add.click();
  await page.getByLabel('API 密钥', { exact: true }).fill('slow-fixture');
  await page.waitForFunction(() => typeof window.finishOldCatalog === 'function');
  await page.getByLabel('服务商', { exact: true }).selectOption('openai');
  await page.getByLabel('API 密钥', { exact: true }).fill('test-only');
  await page.getByLabel('模型名称', { exact: true }).selectOption('model-b');
  await page.evaluate(async () => { window.finishOldCatalog(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'model-b', 'An old provider response must not overwrite the current selection');
  assert.equal(await page.getByLabel('模型名称', { exact: true }).locator('option[value="stale-model"]').count(), 0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('fixture-busy', 'true'));
  await page.reload();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '设置', exact: true }).click();
  await add.click();
  assert.equal(await page.getByRole('dialog', { name: '添加 API', exact: true }).count(), 1, 'Runtime busy must not silently block opening the API form');
  assert.equal(await page.getByRole('button', { name: '保存 API', exact: true }).isDisabled(), true);
  await page.getByRole('dialog').getByText('当前正在处理任务或验证连接，结束后即可保存或切换配置。').waitFor();
  console.log('PASS: visible API dialog, focus/Escape, provider/model dropdowns, persisted model switching');
} finally { await browser.close(); }
