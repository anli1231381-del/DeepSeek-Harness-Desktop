import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { BASE } from './ui-server.mjs';

const mock = {
  schemaVersion:1,
  projects:[{id:'proj-1',name:'SuperRigging',path:'.',updatedAt:new Date().toISOString()}],
  sessions:[
    {id:'s-1',projectId:'proj-1',title:'修复 Runtime',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),schemaVersion:1},
    {id:'s-2',projectId:'proj-1',title:'UI 改进',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),schemaVersion:1},
    {id:'s-3',projectId:null,title:'未关联临时',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),schemaVersion:1},
    {id:'s-empty',projectId:null,title:'空会话',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),schemaVersion:1}
  ],
  messages:[
    {id:'m1',sessionId:'s-1',role:'user',content:'请检查迁移逻辑',createdAt:new Date(Date.now()-60000).toISOString()},
    {id:'m2',sessionId:'s-1',role:'assistant',content:'已发现问题，准备修复',createdAt:new Date(Date.now()-30000).toISOString()}
  ],
  executions:[
    {id:'e1',sessionId:'s-1',createdAt:new Date(Date.now()-20000).toISOString(),status:'succeeded',logs:['搜索代码','修改文件','运行测试']}
  ],
  artifacts:[
    {id:'a1',executionId:'e1',sessionId:'s-1',path:'src/runtime/core.mjs',changeType:'modified',diff:'+ 修复迁移',beforeHash:null,afterHash:'hash123',createdAt:new Date().toISOString()}
  ]
};

async function withPage(fn) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try { await fn(page); } finally { await page.close(); await browser.close(); }
}

test('SessionView mock end-to-end UI', async () => {
  await withPage(async page => {
    await page.addInitScript(snapshot => {
      window.isTauri = true; window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async command => command === 'bridge' ? { ...snapshot, tasks: [], connections: [], settings: {}, runtime: {} } : 1 };
      if (!localStorage.getItem('harness-current-session')) localStorage.setItem('harness-current-session', 's-1');
    }, mock);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Sidebar has project name
    await page.waitForSelector('text=SuperRigging');
    const projectVisible = await page.isVisible('text=SuperRigging');
    assert.equal(projectVisible, true);

    // Header shows session title
    await page.waitForSelector('text=修复 Runtime');
    assert.equal(await page.isVisible('text=修复 Runtime'), true);

    // Messages present
    await page.waitForSelector('text=请检查迁移逻辑');
    assert.equal(await page.isVisible('text=请检查迁移逻辑'), true);
    assert.equal(await page.isVisible('text=已发现问题，准备修复'), true);

    // Execution toggle exists
    await page.waitForSelector('text=执行过程');
    assert.equal(await page.isVisible('text=执行过程'), true);

    // Expand execution and check logs and artifact
    await page.click('text=执行过程');
    await page.waitForSelector('text=搜索代码');
    assert.equal(await page.isVisible('text=搜索代码'), true);
    // Artifact path shown
    await page.waitForSelector('text=src/runtime/core.mjs');
    assert.equal(await page.isVisible('text=src/runtime/core.mjs'), true);

    // Switch to Session UI 改进
    await page.click('text=UI 改进');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.session-title').innerText(), 'UI 改进');
    assert.equal(await page.isVisible('text=UI 改进'), true);

    // Switch to unlinked
    await page.click('text=未关联临时');
    await page.waitForTimeout(200);
    assert.equal(await page.isVisible('text=未关联项目'), true);

    // Empty session
    await page.click('text=空会话');
    await page.waitForSelector('text=还没有消息');
    assert.equal(await page.isVisible('text=还没有消息'), true);

    // Refresh preserves currentSessionId (set to s-empty)
    await page.evaluate(() => { localStorage.setItem('harness-current-session', 's-empty'); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('text=空会话');
    assert.equal(await page.isVisible('text=空会话'), true);

    // cleanup mock
    await page.evaluate(() => { if (window.__harness_setMockSnapshot) window.__harness_setMockSnapshot(null); localStorage.removeItem('harness-current-session'); });
  });
});
