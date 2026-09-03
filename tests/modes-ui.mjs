import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.addInitScript(() => {
    window.isTauri = true;
    window.modeCalls = [];
    window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command, args = {}) => {
      window.modeCalls.push({ command, ...args });
      if (command !== 'bridge') return 1;
      return { projects: [], tasks: [], connections: [], settings: { harnessPath: '', provider: 'deepseek-official', model: 'deepseek-v4-flash', activeConnectionId: '' }, runtime: { available: true, connected: false, nodeVersion: 'v24', source: 'bundled', message: '已检测' } };
    } };
  });
  await page.goto('http://127.0.0.1:1420');
  await page.getByLabel('描述任务目标').fill('这份工作草稿应当保留');
  await page.getByRole('button', { name: '对话模式', exact: true }).click();
  await page.getByRole('heading', { name: 'DeepSeek 对话', exact: true }).waitFor();
  await page.waitForFunction(() => window.modeCalls.some(call => call.command === 'chat_view' && call.visible && call.width > 400 && call.height > 300));
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.waitForFunction(() => window.modeCalls.filter(call => call.command === 'chat_view').at(-1)?.visible === false);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.modeCalls.filter(call => call.command === 'chat_view').at(-1)?.visible === true);
  await page.setViewportSize({ width: 960, height: 680 });
  await page.waitForFunction(() => window.modeCalls.filter(call => call.command === 'chat_view').at(-1)?.width < 750);
  await page.getByRole('button', { name: '刷新网页', exact: true }).click();
  await page.getByRole('button', { name: '在浏览器打开', exact: true }).click();
  await page.getByRole('button', { name: '工作模式', exact: true }).click();
  assert.equal(await page.getByLabel('描述任务目标').inputValue(), '这份工作草稿应当保留');
  await page.waitForFunction(() => window.modeCalls.filter(call => call.command === 'chat_view').at(-1)?.visible === false);
  const calls = await page.evaluate(() => window.modeCalls);
  assert.ok(calls.some(call => call.command === 'reload_chat'));
  assert.ok(calls.some(call => call.command === 'open_deepseek_web'));
  assert.equal(calls.some(call => ['start_task', 'stop_task', 'save_settings'].includes(call.operation)), false);
  console.log('PASS: mode switch preserves work draft; native view show/hide, reload and official browser entry');
} finally { await browser.close(); }
