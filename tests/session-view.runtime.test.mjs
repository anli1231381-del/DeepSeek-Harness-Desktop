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

test('SessionView real runtime integration', async () => {
  const dir = await tmpDir();
  const stateFile = path.join(dir, 'state.json');
  const now = new Date().toISOString();
  const snapshot = {
    schemaVersion: 1,
    projects: [{ id: 'proj-1', name: 'SuperRigging', path: '.', updatedAt: now }],
    sessions: [
      { id: 's-1', projectId: 'proj-1', title: '修复 Runtime', createdAt: now, updatedAt: now, schemaVersion: 1,
        messages: [
          { id: 'm1', role: 'user', content: '请检查迁移逻辑', createdAt: new Date(Date.now()-60000).toISOString() },
          { id: 'm2', role: 'assistant', content: '已发现问题，准备修复', createdAt: new Date(Date.now()-30000).toISOString() }
        ],
        executions: [ { id: 'e1', createdAt: new Date(Date.now()-20000).toISOString(), status: 'succeeded', logs: ['搜索代码','修改文件','运行测试'] } ],
        artifacts: [ { id: 'a1', executionId: 'e1', path: 'src/runtime/core.mjs', changeType: 'modified', diff: '+ 修复迁移', beforeHash: null, afterHash: 'hash123', createdAt: now } ]
      },
      { id: 's-2', projectId: 'proj-1', title: 'UI 改进', createdAt: now, updatedAt: now, schemaVersion: 1 },
    ],
    messages: [],
    executions: [],
    artifacts: [],
    settings: {}
  };
  await writeState(stateFile, snapshot);

  // start runtime controller pointing to this state file
  const controller = await createController({ stateFile });

  // sanity-check controller snapshot
  const ctrlSnap = await controller.dispatch('snapshot');
  if (!Array.isArray(ctrlSnap.sessions) || !ctrlSnap.sessions.find(s => s.id === 's-1')) throw new Error('runtime snapshot not loaded correctly');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    // expose a bridge function that proxies to runtime controller.dispatch
    await page.exposeFunction('__playwright_bridge_dispatch', async (operation, params) => {
      // controller.dispatch expects (operation, params)
      const res = await controller.dispatch(operation, params || {});
      return res;
    });

    // prepare page to use tauri bridge that calls the exposed function
    await page.addInitScript(() => {
      // mark as tauri/desktop so src/api.ts uses invoke
      window.isTauri = true; window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      window.__TAURI_INTERNALS__ = { transformCallback: () => 1,
        invoke: async (command, { operation, params } = {}) => {
          if (command !== 'bridge') return 1;
          // @ts-ignore
          return window.__playwright_bridge_dispatch(operation, params);
        }
      };
    });

    // set current session so SessionView mounts that session
    await page.addInitScript(() => { localStorage.setItem('harness-current-session', 's-1'); });

    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Debug: ask page to call the exposed bridge and return snapshot
    const pageSnap = await page.evaluate(async () => {
      // @ts-ignore
      return await window.__playwright_bridge_dispatch('snapshot');
    });
    // ensure page sees messages from runtime
    // eslint-disable-next-line no-console
    console.log('PAGE SNAPSHOT KEYS:', Object.keys(pageSnap || {}));
    // eslint-disable-next-line no-console
    console.log('PAGE SNAPSHOT MESSAGES:', JSON.stringify(pageSnap.messages || []));
    if (!Array.isArray(pageSnap.messages) || !pageSnap.messages.find(m => m.sessionId === 's-1')) throw new Error('page bridge did not return messages');

    // verify UI elements loaded from runtime
    await page.waitForSelector('text=SuperRigging');
    // check session header text
    const header = await page.evaluate(() => document.querySelector('.session-title')?.textContent || null);
    assert.equal(header, '修复 Runtime');
    // debug output of main content for investigation
    const bodyText = await page.evaluate(() => document.body.innerText);
    // eslint-disable-next-line no-console
    console.log('BODY TEXT SNIPPET:', bodyText.slice(0, 800));
    assert.equal(await page.isVisible('text=请检查迁移逻辑'), true);
    assert.equal(await page.isVisible('text=已发现问题，准备修复'), true);

    await page.click('.execution-toggle');
    await page.waitForSelector('text=搜索代码');
    assert.equal(await page.isVisible('text=src/runtime/core.mjs'), true);

    // test session switch - wait until header updates to the new session title
    await page.click('text=UI 改进');
    await page.waitForFunction(() => document.querySelector('.session-title')?.textContent === 'UI 改进');
    const newHeader = await page.evaluate(() => document.querySelector('.session-title')?.textContent || null);
    assert.equal(newHeader, 'UI 改进');

    // simulate invalid currentSessionId fallback: set localStorage to non-existent id then reload
    await page.evaluate(() => { localStorage.setItem('harness-current-session', 's-999'); });
    await page.reload({ waitUntil: 'networkidle' });
    // page should either show '请选择会话' or pick first available; check it doesn't crash and shows project list
    assert.equal(await page.isVisible('text=SuperRigging'), true);

    // cleanup
    await page.evaluate(() => { localStorage.removeItem('harness-current-session'); });
  } finally {
    await page.close();
    await browser.close();
    // stop runtime controller if it exposes stop; controller has no stop but allow GC
  }
});
