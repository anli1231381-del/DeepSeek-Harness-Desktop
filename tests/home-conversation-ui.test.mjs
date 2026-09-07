import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createController } from '../runtime/core.mjs';
import { BASE } from './ui-server.mjs';

test('default home chats without a project and preserves conversation when associating projects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-home-'));
  let page;
  const prompts = [];
  const app = await createController({ stateFile: join(dir, 'state.json'), onChanged: () => { void page?.evaluate(() => window.emitChange?.()).catch(() => {}); }, _test_inject: { makeHarness: project => ({
    async run(prompt) { prompts.push({ prompt, cwd: project.path }); return { finalResponse: '回复 ' + prompts.length, events: [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] }; }, async close() {},
  }) } });
  const browser = await chromium.launch();
  try {
    page = await browser.newPage();
    await page.exposeFunction('dispatchBridge', (operation, params) => app.dispatch(operation, params));
    await page.addInitScript(() => {
      window.isTauri = true;
      const callbacks = new Map(), listeners = new Map(); let id = 0;
      window.emitChange = () => listeners.forEach(handler => callbacks.get(handler)?.({ payload: {} }));
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event, key) { listeners.delete(key); } };
      window.__TAURI_INTERNALS__ = { transformCallback(fn) { callbacks.set(++id, fn); return id; }, async invoke(command, args = {}) {
        if (command === 'plugin:event|listen') { listeners.set(++id, args.handler); return id; }
        return command === 'bridge' ? window.dispatchBridge(args.operation, args.params) : 1;
      } };
    });
    await page.goto(BASE);
    assert.equal(await page.getByRole('group', { name: '切换模式' }).count(), 0);
    const input = page.getByRole('textbox', { name: '消息输入' });
    await input.fill('先讨论小游戏');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('回复 1', { exact: true }).waitFor();
    assert.equal(await page.locator('.message.user .message-bubble').count(), 1);
    assert.equal(await page.locator('.message.assistant .message-bubble').count(), 1);
    assert.equal(await page.locator('.message.assistant .message-role').count(), 0);
    const process = page.getByRole('button', { name: /用时/ }).first();
    if (await process.getAttribute('aria-expanded') === 'false') await process.click();
    await page.getByText('来自真实执行事件与工具记录').waitFor();
    await page.getByRole('button', { name: '登录 DeepSeek' }).click();
    await page.getByRole('dialog', { name: '连接 DeepSeek 账号' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '工作模式 API 设置' }).count(), 1);
    await page.screenshot({ path: 'test-results/deepseek-login-popover.png', fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '外观' }).click();
    await page.getByLabel('主题色 HEX').fill('#e76f51');
    assert.match(await page.locator('html').evaluate(node => node.style.getPropertyValue('--sidebar')), /#e76f51/);
    await page.keyboard.press('Escape');
    await input.fill('继续讨论');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('回复 2', { exact: true }).waitFor();
    assert.match(prompts[1].prompt, /先讨论小游戏/);
    const original = (await app.dispatch('snapshot')).sessions[0].id;
    const projectPath = join(dir, 'game'); await mkdir(projectPath);
    const added = await app.dispatch('add_project', { path: projectPath });
    await page.getByLabel('关联项目（可选）').selectOption(added.projects[0].id);
    await page.getByText(projectPath, { exact: true }).waitFor();
    await input.fill('开始制作');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('回复 3', { exact: true }).waitFor();
    assert.match(prompts[2].prompt, /先讨论小游戏/);
    assert.equal(prompts[2].cwd.toLowerCase(), projectPath.toLowerCase());
    assert.equal((await app.dispatch('snapshot')).sessions.find(s => s.id === original).projectId, added.projects[0].id);
    await page.getByRole('button', { name: '在 game 中新建对话', exact: true }).click();
    await page.getByText('回复 3', { exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByText('回复 3', { exact: true }).count(), 0);
    await page.getByTestId('session-' + original).click();
    await page.getByText('回复 3', { exact: true }).waitFor();
    await page.screenshot({ path: 'test-results/conversation-redesign.png', fullPage: true });
    assert.equal(await page.getByRole('button', { name: '开始任务', exact: true }).count(), 0);
  } finally { await app.close(); await browser.close(); }
});
