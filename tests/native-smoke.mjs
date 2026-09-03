import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { verifyChat } from './native-chat.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const executable = process.env.HARNESS_DESKTOP_EXE;
if (!executable) throw new Error('Set HARNESS_DESKTOP_EXE to the built executable');
const root = await mkdtemp(join(tmpdir(), 'harness-native-'));
const project = join(root, '联通测试项目');
await mkdir(project); await mkdir('test-results', { recursive: true });
const call = promisify(execFile);
await call('git', ['-C', project, 'init'], { windowsHide: true });
await writeFile(join(project, 'welcome.txt'), '这是用于验证修改预览的本地测试文件。\n');
let requests = 0; let requestModel; let requestKey; let releaseModelReply;
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'first-native-model' }, { id: 'custom-native-model' }] })); return; }
  let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { requestModel = JSON.parse(body).model; requestKey = req.headers.authorization;
    const reply = () => {
    requests++; res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"role":"assistant","content":"桌面端联通测试完成。"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":3}}\n\n');
    res.end('data: [DONE]\n\n');
    };
    if (process.env.HARNESS_SMOKE_CHAT) releaseModelReply = reply; else reply();
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = 19327;
const app = spawn(executable, [], { cwd: dirname(executable), windowsHide: true, stdio: 'ignore', env: {
  ...process.env, HARNESS_DESKTOP_DATA: join(root, 'app-data'), WEBVIEW2_USER_DATA_FOLDER: join(root, 'webview'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
  HARNESS_DESKTOP_HARNESS: process.env.HARNESS_SMOKE_HARNESS || '', ...(process.env.HARNESS_SMOKE_ISOLATED ? { PATH: `${process.env.SystemRoot};${process.env.SystemRoot}/System32;${process.env.SystemRoot}/System32/WindowsPowerShell/v1.0` } : {}), DSH_HOME: join(root, 'dsh'),
  DEEPSEEK_API_KEY: 'local-smoke-dummy-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}`,
  DSH_PERMISSION_MODE: 'read-only', DSH_TELEMETRY_DISABLED: '1',
} });
let exited = false; app.on('exit', () => { exited = true; });
let browser;
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (exited) throw new Error('Desktop process exited before WebView was ready');
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) break; } catch {}
    await delay(250);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  let page;
  for (let attempt = 0; attempt < 80; attempt++) {
    page = context.pages().find(p => !p.url().startsWith('devtools:'));
    if (page && await page.locator('.brand').count()) break;
    await delay(250);
  }
  if (!page) throw new Error('Desktop WebView page not found');
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '今天，想完成什么？' }).waitFor();
  const initial = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('bridge', { operation: 'snapshot', params: {} }));
  assert.equal(initial.runtime.available, true, initial.runtime.message);
  assert.equal(initial.runtime.source, process.env.HARNESS_SMOKE_HARNESS ? 'local' : 'bundled');
  if (!process.env.HARNESS_SMOKE_HARNESS) assert.ok(initial.runtime.nodePath.replaceAll('\\', '/').includes('/runtime/node/'));
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('radio', { name: '深色', exact: true }).check();
  await page.getByLabel('主题色色盘', { exact: true }).fill('#d92e87');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  const colors = await page.evaluate(() => ({ background: getComputedStyle(document.documentElement).backgroundColor, foreground: getComputedStyle(document.body).color }));
  assert.ok(colors.background.match(/\d+/g).slice(0, 3).map(Number).every(value => value < 80), `Dark canvas: ${colors.background}`);
  assert.ok(colors.foreground.match(/\d+/g).slice(0, 3).map(Number).every(value => value > 180), `Readable text: ${colors.foreground}`);
  await page.reload();
  await page.getByRole('button', { name: '外观', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-accent'), '#d92e87');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.screenshot({ path: 'test-results/desktop-dark.png' });
  await page.getByRole('button', { name: '恢复默认' }).click();
  await page.keyboard.press('Escape');
  if (process.env.HARNESS_SMOKE_CHAT) await verifyChat(page, context, app.pid);
  await page.evaluate(path => window.__TAURI_INTERNALS__.invoke('bridge', { operation: 'add_project', params: { path } }), project);
  await page.getByRole('combobox', { name: '当前项目' }).selectOption({ label: '联通测试项目' });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '设置', exact: true }).click();
  await page.setViewportSize({ width: 960, height: 680 });
  await page.getByRole('button', { name: '添加 API', exact: true }).click();
  const editorPosition = await page.locator('.connection-editor').evaluate(element => ({ top: element.getBoundingClientRect().top, viewport: innerHeight, focused: element.contains(document.activeElement) }));
  console.log('API editor visibility:', editorPosition);
  assert.equal(await page.getByRole('dialog', { name: '添加 API', exact: true }).count(), 1, 'Add API must open an immediately visible dialog');
  assert.equal(editorPosition.focused, true, 'Opening the API editor must move keyboard focus into it');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '添加 API', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: '添加 API', exact: true }).click();
  for (const [provider, address] of [['deepseek', 'https://api.deepseek.com'], ['openai', 'https://api.openai.com/v1'], ['anthropic', 'https://api.anthropic.com']]) {
    await page.getByLabel('服务商', { exact: true }).selectOption(provider);
    assert.equal(await page.getByLabel('API 地址', { exact: true }).inputValue(), address);
  }
  await page.getByLabel('服务商', { exact: true }).selectOption('custom');
  await page.getByLabel('配置名称', { exact: true }).fill('本地测试服务');
  await page.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:' + server.address().port + '/v1');
  await page.getByLabel('API 密钥', { exact: true }).fill('native-custom-key');
  await page.getByLabel('模型名称', { exact: true }).selectOption('first-native-model');
  await page.getByRole('button', { name: '保存 API', exact: true }).click();
  await page.getByText('本地测试服务', { exact: true }).waitFor();
  await page.getByRole('button', { name: '编辑 本地测试服务', exact: true }).click();
  await page.getByLabel('模型名称', { exact: true }).selectOption('custom-native-model');
  await page.getByRole('button', { name: '保存 API', exact: true }).click();
  await page.getByText('本地测试服务', { exact: true }).waitFor();
  await page.getByRole('button', { name: '检测已有配置', exact: true }).click();
  await page.getByLabel('Harness 模型', { exact: true }).selectOption('deepseek-v4-pro');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByText('运行设置已保存。', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.locator('.connection-row').filter({ hasText: '本地测试服务' }).getByRole('button', { name: '使用', exact: true }).click();
  await page.locator('.connection-row').filter({ hasText: '本地测试服务' }).getByRole('button', { name: '当前使用', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/model-settings.png', fullPage: true });
  await page.getByRole('button', { name: '检测并验证连接' }).click();
  await page.getByText('运行环境已就绪，可以开始任务', { exact: true }).waitFor({ timeout: 45000 });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '首页', exact: true }).click();
  await page.locator('textarea').fill('仅回复一句确认文字，不调用工具。');
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  if (process.env.HARNESS_SMOKE_CHAT) {
    await page.getByRole('button', { name: '对话模式', exact: true }).click();
    for (let i = 0; i < 100 && !releaseModelReply; i++) await delay(200);
    assert.ok(releaseModelReply, 'Task reaches the model while chat mode is visible');
    const duringChat = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('bridge', { operation: 'snapshot' }));
    assert.equal(duringChat.tasks[0].status, 'running');
    releaseModelReply(); releaseModelReply = undefined;
    await page.waitForFunction(async () => (await window.__TAURI_INTERNALS__.invoke('bridge', { operation: 'snapshot' })).tasks[0].status === 'completed');
    await page.getByRole('button', { name: '工作模式', exact: true }).click();
    console.log('PASS: running work task completes while official chat remains visible');
  }
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '任务', exact: true }).click();
  await page.getByText('桌面端联通测试完成。', { exact: true }).waitFor({ timeout: 60000 });
  assert.equal(requests, 1); assert.equal(requestModel, 'custom-native-model'); assert.equal(requestKey, 'Bearer native-custom-key');
  const completed = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('bridge', { operation: 'snapshot', params: {} }));
  assert.equal(completed.tasks[0].status, 'completed');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: /^修改/ }).click();
  if (process.env.HARNESS_SMOKE_ISOLATED) await page.getByText(/尚未安装 Git，任务仍可使用/).first().waitFor();
  else { await page.getByRole('button', { name: /welcome.txt/ }).click(); await page.getByLabel('文件差异').getByText(/这是用于验证修改预览/).waitFor(); }
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('heading', { name: '联通测试项目', exact: true }).waitFor();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '首页', exact: true }).click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.screenshot({ path: 'test-results/desktop-light.png' });
  assert.deepEqual(errors, []);
  if (process.env.HARNESS_SMOKE_DISCONNECT) {
  // Terminate only this test app's own bridge child to verify disconnected UI state.
  await call('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${app.pid}" | Where-Object { $_.CommandLine -match 'bridge.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { windowsHide: true });
  await page.getByText('本地运行环境已断开，请重新启动应用。', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('连接已验证', { exact: true }).count(), 0);
  }
  console.log(JSON.stringify({ result: 'PASS', checks: ['native startup', 'bundled Harness and Node detection', 'SDK handshake', 'real IPC task with local model stub', 'task events and response', process.env.HARNESS_SMOKE_ISOLATED ? 'missing Git guidance' : 'Git file preview', 'project navigation', 'custom color picker persistence', 'API form, selection and actual model request'], taskEvents: completed.tasks[0].activities.length, localModelRequests: requests, screenshots: [resolve('test-results/desktop-light.png'), resolve('test-results/desktop-dark.png')] }, null, 2));
} finally {
  if (!exited) {
    // Tauri also owns small message windows; close the actual application window.
    await call('pwsh', ['-NoProfile', '-NonInteractive', '-File', resolve('tests/native-window.ps1'), '-TargetPid', String(app.pid), '-Close'], { windowsHide: true }).catch(() => {});
    for (let i = 0; i < 100 && !exited; i++) await delay(250);
    if (!exited) { app.kill(); throw new Error('Desktop process did not close in time'); }
  }
  await browser?.close().catch(() => {});
  await new Promise(r => server.close(r));
}
