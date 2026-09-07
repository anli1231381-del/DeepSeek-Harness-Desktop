import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createController } from '../runtime/core.mjs';
import { BASE } from './ui-server.mjs';

test('session UI retains drafts, stops running work and cancels queued work without a reload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-queue-ui-'));
  let page, calls = 0, notify;
  const app = await createController({ stateFile: join(dir, 'state.json'), onChanged: () => { void page?.evaluate(() => window.emitChange?.()).catch(() => {}); }, _test_inject: { makeHarness: () => {
    let release;
    return { run(_prompt, options) { calls++; notify = options.onNotification; return new Promise(resolve => { release = () => resolve({ events: [] }); }); }, async close() { release?.(); } };
  } } });
  const browser = await chromium.launch();
  try {
    for (const id of ['a', 'b']) await app.dispatch('create_session', { session: { id, title: '会话 ' + id, projectId: null } });
    page = await browser.newPage();
    await page.exposeFunction('dispatchBridge', (operation, params) => app.dispatch(operation, params));
    await page.addInitScript(() => {
      window.isTauri = true;
      const callbacks = new Map(), listeners = new Map();
      let nextId = 0;
      window.emitChange = () => listeners.forEach(handler => callbacks.get(handler)?.({ payload: {} }));
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event, id) { listeners.delete(id); } };
      window.__TAURI_INTERNALS__ = {
        transformCallback(fn) { callbacks.set(++nextId, fn); return nextId; },
        async invoke(command, args = {}) {
          if (command === 'plugin:event|listen') { listeners.set(++nextId, args.handler); return nextId; }
          if (command !== 'bridge') return 1;
          return window.dispatchBridge(args.operation, args.params);
        },
      };
      localStorage.setItem('harness-current-session', 'a');
    });
    await page.goto(BASE);
    const input = page.getByRole('textbox', { name: '消息输入' });
    await input.fill('草稿 a');
    await page.getByTestId('session-b').click();
    assert.equal(await input.inputValue(), '');
    await input.fill('草稿 b');
    await page.getByTestId('session-a').click();
    assert.equal(await input.inputValue(), '草稿 a');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('button', { name: '停止执行', exact: true }).waitFor();
    await page.locator('.execution-toggle').click();
    notify({ method: 'session.event', params: { event: { type: 'tool/call', data: { name: 'read_file' } } } });
    await page.locator('.execution-logs').getByText('正在调用 read_file', { exact: false }).waitFor();
    await page.getByTestId('session-b').click();
    assert.equal(await input.inputValue(), '草稿 b');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('button', { name: '取消排队', exact: true }).click();
    await page.locator('.session-body').getByText('执行已停止，可能存在部分修改。', { exact: true }).waitFor();
    assert.equal(calls, 1);
    await page.getByTestId('session-a').click();
    await page.getByRole('button', { name: '停止执行', exact: true }).click();
    await page.locator('.session-body').getByText('执行已停止，可能存在部分修改。', { exact: true }).waitFor();
    assert.equal((await app.dispatch('snapshot')).messages.filter(m => m.role === 'assistant').length, 0);
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/session-queue.png', fullPage: true });
  } finally { await app.close(); await browser.close(); }
});
