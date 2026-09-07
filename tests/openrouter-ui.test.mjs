import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BASE } from './ui-server.mjs';

test('OpenRouter preset discovers models and saves the selected OpenAI-compatible route', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.isTauri = true;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      const snapshot = { projects: [], sessions: [], tasks: [], connections: [], settings: { activeConnectionId: '', provider: '', model: '', harnessPath: '' }, runtime: {} };
      window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command, args = {}) => {
        if (command !== 'bridge') return 1;
        if (args.operation === 'api_models') { window.catalogRequest = args.params.connection; return { models: [{ id: 'openai/test-model', name: 'Test Model' }], message: '已获取模型' }; }
        if (args.operation === 'save_connection') { window.savedConnection = args.params.connection; snapshot.connections = [{ ...args.params.connection, id: 'saved', hasApiKey: true }]; }
        return snapshot;
      } };
    });
    await page.goto(BASE);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '添加 API', exact: true }).click();
    assert.equal(await page.getByLabel('服务商', { exact: true }).locator('option[value="openrouter"]').count(), 1);
    await page.getByLabel('服务商', { exact: true }).selectOption('openrouter');
    assert.equal(await page.getByLabel('API 地址', { exact: true }).inputValue(), 'https://openrouter.ai/api/v1');
    assert.equal(await page.getByLabel('接口协议').inputValue(), 'openai-completions');
    await page.getByLabel('API 密钥', { exact: true }).fill('fixture-openrouter-key');
    await page.getByRole('button', { name: '获取模型', exact: true }).click();
    await page.getByText('已获取模型', { exact: true }).waitFor();
    await page.getByRole('button', { name: '保存 API', exact: true }).click();
    await page.getByRole('button', { name: '编辑 OpenRouter', exact: true }).waitFor();
    const saved = await page.evaluate(() => window.savedConnection);
    assert.equal(saved.baseUrl, 'https://openrouter.ai/api/v1');
    assert.equal(saved.model, 'openai/test-model');
    assert.equal(saved.protocol, 'openai-completions');
    await page.getByRole('button', { name: '编辑 OpenRouter', exact: true }).click();
    assert.equal(await page.getByLabel('服务商', { exact: true }).inputValue(), 'openrouter');
  } finally { await browser.close(); }
});
