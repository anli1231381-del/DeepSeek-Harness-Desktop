import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

// Run from native-smoke.mjs with a fresh WebView profile; no personal login is used.
export async function verifyChat(page, context, pid) {
  const windows = async name => JSON.parse((await promisify(execFile)('pwsh', ['-NoProfile', '-NonInteractive', '-File', resolve('tests/native-window.ps1'), '-TargetPid', String(pid), '-Screenshot', resolve(`test-results/${name}.png`)], { windowsHide: true })).stdout);
  await page.getByRole('button', { name: '对话模式', exact: true }).click();
  await page.getByRole('heading', { name: 'DeepSeek 对话', exact: true }).waitFor();
  let chat;
  await assert.doesNotReject(async () => {
    for (let i = 0; i < 60; i++) {
      chat = context.pages().find(candidate => candidate.url().startsWith('https://chat.deepseek.com/'));
      if (chat) return;
      await page.waitForTimeout(250);
    }
    throw new Error('Official chat WebView was not created');
  });
  await chat.waitForLoadState('domcontentloaded', { timeout: 60000 });
  try { await chat.waitForFunction(() => document.title.toLowerCase().includes('deepseek'), undefined, { timeout: 30000 }); }
  catch (error) {
    console.log('Chat page diagnostic:', { url: chat.url(), title: await chat.title(), text: (await chat.locator('body').innerText()).slice(0, 400) });
    await chat.screenshot({ path: 'test-results/deepseek-web.png' });
    throw error;
  }
  await chat.locator('input[type="password"]').waitFor();
  await page.waitForFunction(async () => {
    const bounds = document.querySelector('.chat-viewport').getBoundingClientRect();
    const position = await window.__TAURI_INTERNALS__.invoke('plugin:webview|webview_position', { label: 'deepseek-chat' });
    const size = await window.__TAURI_INTERNALS__.invoke('plugin:webview|webview_size', { label: 'deepseek-chat' });
    return Math.abs(position.x - bounds.x * devicePixelRatio) < 2 && Math.abs(position.y - bounds.y * devicePixelRatio) < 2 && Math.abs(size.width - bounds.width * devicePixelRatio) < 2 && Math.abs(size.height - bounds.height * devicePixelRatio) < 2;
  });
  await chat.screenshot({ path: 'test-results/deepseek-web.png' });
  const views = (await windows('chat-window')).filter(view => view.class === 'WRY_WEBVIEW').sort((a, b) => a.width * a.height - b.width * b.height);
  assert.equal(views.length, 2, 'Work and chat have independent native views');
  const chatHandle = views[0].id;
  assert.equal(views[0].visible, true);
  const denied = await chat.evaluate(async () => {
    if (!window.__TAURI_INTERNALS__?.invoke) return true;
    try { await window.__TAURI_INTERNALS__.invoke('bridge', { operation: 'snapshot' }); return false; }
    catch { return true; }
  });
  assert.equal(denied, true, 'Remote page cannot access the local runtime');
  await chat.evaluate(() => { window.__modeSmokeMarker = 'retained'; });
  await page.getByRole('button', { name: '工作模式', exact: true }).click();
  await page.waitForTimeout(500);
  // WebView2 can keep document.visibilityState visible even when its native HWND is hidden.
  assert.equal((await windows('work-window')).find(view => view.id === chatHandle).visible, false);
  await page.getByLabel('描述任务目标').fill('工作模式草稿');
  await page.getByRole('button', { name: '对话模式', exact: true }).click();
  assert.equal((await windows('chat-restored')).find(view => view.id === chatHandle).visible, true);
  assert.equal(await chat.evaluate(() => window.__modeSmokeMarker), 'retained', 'Switching must not reload the website');
  assert.equal(context.pages().filter(candidate => candidate.url().startsWith('https://chat.deepseek.com/')).length, 1);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('dialog', { name: '界面外观', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '刷新网页', exact: true }).click();
  await chat.waitForFunction(() => window.__modeSmokeMarker === undefined);
  await page.getByRole('button', { name: '工作模式', exact: true }).click();
  assert.equal(await page.getByLabel('描述任务目标').inputValue(), '工作模式草稿');
  console.log('PASS: native official website, remote IPC denied, retained WebView, explicit reload and independent work draft');
}
