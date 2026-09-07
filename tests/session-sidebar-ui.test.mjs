import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE } from './ui-server.mjs';
const { chromium } = await import('playwright');
test('session sidebar groups and selection persist', async () => {
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', error => console.error(error));
  await page.addInitScript(() => {
    window.isTauri = true; window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.modeCalls = [];
    window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command, args = {}) => {
      window.modeCalls.push({ command, ...args });
      if (command !== 'bridge') return 1;
      if (args.operation === 'changes') return { files: [] };
      // Provide a snapshot containing projects and sessions (including an empty project)
      return {
        schemaVersion: 1, tasks: [], connections: [], settings: {},
        projects: [
          { id: 'p1', name: 'Project One', path: '.' },
          { id: 'p2', name: 'Empty Project', path: '.' }
        ],
        sessions: [
          { id: 's-unlinked', title: 'Unlinked Session', projectId: null },
          { id: 's1', title: 'Session A', projectId: 'p1' },
          { id: 's2', title: 'Session B', projectId: 'p1' }
        ],
        messages: [],
        executions: [],
        artifacts: [],
        runtime: { available: true, connected: false, nodeVersion: 'v24', source: 'bundled', message: '已检测' }
      };
    } };
  });

  const base = BASE;
  await page.goto(base);

  // Wait for sidebar to render
  await page.waitForSelector('.session-sidebar');

  // 1) Unlinked sessions group shows the unlinked session
  const unlinkedBtn = page.getByTestId('session-s-unlinked');
  await unlinkedBtn.waitFor();
  assert.equal(await unlinkedBtn.innerText(), 'Unlinked Session');

  // 2) Project group shows sessions
  await page.locator('.session-sidebar').getByText('Project One').waitFor();
  const s1 = page.getByTestId('session-s1');
  const s2 = page.getByTestId('session-s2');
  await s1.waitFor(); await s2.waitFor();
  assert.equal(await s1.innerText(), 'Session A');
  assert.equal(await s2.innerText(), 'Session B');

  // 3) Empty project shows (空)
  await page.locator('.session-sidebar').getByText('Empty Project').waitFor();
  const emptyProjNote = await page.locator('.session-group', { hasText: 'Empty Project' }).getByText('(空)');
  await emptyProjNote.waitFor();

  // 4) Clicking a session selects it and breadcrumb shows the session id; selection persists across reload
  await s1.click();
  await page.waitForFunction(() => document.querySelector('.current-session') && document.querySelector('.current-session').textContent.trim().length > 0);
  const currentAfter = (await page.locator('.current-session').textContent()).trim();
  assert.equal(currentAfter, 's1');

  // Reload and ensure selection persists
  await page.reload();
  await page.waitForSelector('.session-sidebar');
  await page.waitForFunction(() => document.querySelector('.current-session') && document.querySelector('.current-session').textContent.trim().length > 0);
  const currentAfterReload = (await page.locator('.current-session').textContent()).trim();
  assert.equal(currentAfterReload, 's1');

  console.log('PASS: session sidebar groups, empty project, unlinked sessions, and selection persistence');
} finally { await browser.close(); }

});
