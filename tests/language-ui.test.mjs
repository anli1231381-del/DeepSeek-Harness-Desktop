import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BASE } from './ui-server.mjs';

test('language switches the main workflow to English and persists after reload', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      if (!localStorage.getItem('harness-language')) localStorage.setItem('harness-language', 'zh-CN');
      localStorage.setItem('harness-current-session', 's');
      const state = { projects: [], tasks: [], sessions: [{ id: 's', projectId: null, title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), schemaVersion: 1 }], messages: [{ id: 'm', sessionId: 's', role: 'user', content: '设置', createdAt: new Date().toISOString() }], executions: [], artifacts: [], connections: [], settings: { harnessPath: '', provider: 'deepseek-official', model: 'deepseek-v4-flash', activeConnectionId: '' }, runtime: { available: true, connected: false, nodeVersion: 'v24', nodePath: 'bundled/node.exe', harnessVersion: '1.0', harnessPath: 'bundled/harness', source: 'bundled', message: '已检测', steps: [{ id: 'webview', label: '桌面界面', status: 'ready', detail: 'WebView2 已启动' }, { id: 'node', label: 'Node.js', status: 'ready', detail: 'v24' }, { id: 'harness', label: 'Harness', status: 'ready', detail: '1.0 · 应用内置' }, { id: 'git', label: 'Git', status: 'optional', detail: '未安装；聊天和文件操作仍可使用，需要差异预览时可一键安装' }, { id: 'model', label: '模型连接', status: 'pending', detail: '尚未验证；请保存 API 或 Harness 配置后检测连接' }] } };
      window.isTauri = true;
      window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command, { operation } = {}) => command === 'bridge' ? operation === 'extensions_snapshot' ? { skills: [], mcpServers: [] } : structuredClone(state) : 1 };
    });
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Language' }).click();
    assert.equal(await page.locator('.message.user .message-bubble').getByText('设置', { exact: true }).count(), 1, 'language switching must not rewrite user content');
    assert.equal(await page.locator('.message.user').getByRole('button', { name: 'Copy', exact: true }).count(), 1, 'controls beside user content must still translate');
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Extensions', exact: true }).click();
    await page.getByRole('heading', { name: 'Extension manager', exact: true }).waitFor();
    await page.getByText('Choose a folder containing SKILL.md. Status shows whether it was discovered or loaded.', { exact: true }).waitFor();
    await page.getByText('Public repositories and specific tree folders are supported. Repository scripts are never run.', { exact: true }).waitFor();
    await page.getByText('Add required keys in headers or env when importing. Keys are encrypted; connection tests list the available tools.', { exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Projects', exact: true }).click();
    await page.getByRole('heading', { name: 'Your projects' }).waitFor();
    assert.equal(await page.getByText('Choose a local folder and continue your work anytime.').count(), 1);
    await page.screenshot({ path: 'test-results/work-en.png', fullPage: true });
    assert.equal(await page.evaluate(() => localStorage.getItem('harness-language')), 'en');
    await page.reload();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Projects', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Environment status' }).waitFor();
    assert.equal(await page.getByText('未安装；聊天和文件操作仍可使用，需要差异预览时可一键安装', { exact: true }).count(), 1, 'runtime details remain verbatim');
    await page.screenshot({ path: 'test-results/environment-en.png', fullPage: true });
  } finally { await browser.close(); }
});
