import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BASE } from './ui-server.mjs';

test('chat reports native errors above the child viewport and recreates on recovery', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.isTauri = true;
      window.calls = [];
      window.callbacks = {};
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback: callback => { const id = Object.keys(window.callbacks).length + 1; window.callbacks[id] = callback; return id; },
        invoke: async (command, args = {}) => {
          window.calls.push({ command, ...args });
          if (command === 'plugin:event|listen' && args.event === 'chat-load') window.chatCallback = args.handler;
          if (command === 'chat_view' && args.visible && !window.recovered) throw 'fixture navigation failure';
          if (command === 'reload_chat' && args.recreate) window.recovered = true;
          if (command !== 'bridge') return 1;
          return { projects: [], sessions: [], tasks: [], connections: [], settings: {}, runtime: {} };
        },
      };
    });
    await page.goto(BASE);
    await page.getByRole('button', { name: '登录 DeepSeek', exact: true }).click();
    await page.getByRole('button', { name: '打开官方登录', exact: true }).click();
    const status = page.locator('.chat-toolbar [role="status"]');
    try { await status.filter({ hasText: 'fixture navigation failure' }).waitFor({ timeout: 5000 }); }
    catch (error) { console.log(await page.evaluate(() => ({ calls: window.calls, text: document.body.innerText, rect: document.querySelector('.chat-viewport')?.getBoundingClientRect().toJSON() }))); throw error; }
    await page.setViewportSize({ width: 1000, height: 720 });
    assert.match(await status.innerText(), /fixture navigation failure/);
    await page.getByRole('button', { name: '重新打开网页', exact: true }).click();
    await page.waitForFunction(() => window.calls.some(call => call.command === 'reload_chat' && call.recreate));
    await page.evaluate(() => window.callbacks[window.chatCallback]({ payload: 'loaded' }));
    await status.filter({ hasText: '官网页面已结束加载' }).waitFor();
    const toolbar = await status.boundingBox();
    const viewport = await page.locator('.chat-viewport').boundingBox();
    assert.ok(toolbar.y + toolbar.height <= viewport.y, 'status stays outside the native child surface');
  } finally { await browser.close(); }
});
