import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createController } from '../runtime/core.mjs';

function tmpDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'ds-runtime-fixture-')); }
async function writeState(file, obj) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(obj, null, 2)); }

import { BASE } from './ui-server.mjs';

test('Composer -> Execution minimal closed-loop', async () => {
  const dir = await tmpDir();
  const stateFile = path.join(dir, 'state.json');
  const now = new Date().toISOString();
  const snapshot = {
    schemaVersion: 1,
    projects: [{ id: 'proj-1', name: 'SuperProject', path: '.', updatedAt: now }],
    sessions: [
      { id: 's-1', projectId: 'proj-1', title: 'Composer 测试会话', createdAt: now, updatedAt: now, schemaVersion: 1 },
      { id: 's-2', projectId: 'proj-1', title: '另一个会话', createdAt: now, updatedAt: now, schemaVersion: 1 }
    ],
    messages: [],
    executions: [],
    artifacts: [],
    settings: {}
  };
  await writeState(stateFile, snapshot);
  const controller = await createController({ stateFile, _test_inject: { makeHarness: () => ({ run: async () => ({ finalResponse: '测试回复', events: [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] }), close: async () => {} }) } });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.exposeFunction('__playwright_bridge_dispatch', async (operation, params) => {
      const res = await controller.dispatch(operation, params || {});
      return res;
    });
    page.on('console', msg => { try { console.log('PAGE CONSOLE:', msg.text()); } catch {} });
    page.on('pageerror', err => { try { console.error('PAGE ERROR:', err?.stack || err?.message || err); } catch {} });
    await page.addInitScript(() => {
      window.isTauri = true; window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      window.__TAURI_INTERNALS__ = { invoke: async (command, { operation, params } = {}) => { if (command !== 'bridge') return 1; return window.__playwright_bridge_dispatch(operation, params); }, transformCallback: (v) => v };
    });
    await page.addInitScript(() => { localStorage.setItem('harness-current-session', 's-1'); });

    await page.goto(BASE, { waitUntil: 'networkidle' });

    for (const message of ['第一次消息', '第二次消息']) {
      await page.getByRole('textbox', { name: '消息输入' }).fill(message);
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await page.locator('.session-body').getByText(message, { exact: true }).waitFor({ timeout: 5000 });
      await page.getByRole('button', { name: '发送', exact: true }).waitFor();
    }
    await page.getByTestId('session-s-2').click();
    await page.locator('.session-body').getByText('还没有消息', { exact: false }).waitFor();
    assert.equal(await page.locator('.session-body').getByText('第一次消息', { exact: true }).count(), 0);
    await page.getByTestId('session-s-1').click();
    await page.locator('.session-body').getByText('第二次消息', { exact: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.session-body').getByText('第二次消息', { exact: true }).waitFor();
    const saved = await controller.dispatch('snapshot');
    assert.equal(saved.messages.filter(m => m.role === 'user').length, 2);
    assert.equal(saved.executions.length, 2);
    assert.ok(saved.executions.every(e => e.sessionId === 's-1'));

  } finally {
    await page.close();
    await browser.close();
  }
});
