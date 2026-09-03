import assert from 'node:assert/strict';
import { existsSync, lstatSync, readdirSync, realpathSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(process.argv[2]);
assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
assert.equal(realpathSync(process.execPath).toLowerCase(), realpathSync(join(root, 'node/node.exe')).toLowerCase(), 'Run this check with the bundled Node executable');
const modules = join(root, 'harness/node_modules');
const require = createRequire(join(root, 'harness/package.json'));
let files = 0;
function inspect(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `Distribution contains a machine-specific link: ${path}`);
    if (stat.isDirectory()) inspect(path); else files++;
  }
}
inspect(root);
for (const pkg of ['dsh', 'dsh-sdk-client', 'dsh-llm-pi-ai']) {
  assert.equal(JSON.parse(readFileSync(join(modules, '@deepseek-ai', pkg, 'package.json'))).version, '0.1.2-alpha.5');
}
assert.ok(existsSync(join(root, 'node/LICENSE')));
assert.ok(existsSync(join(root, 'node/npm.cmd')));
assert.ok(existsSync(join(root, 'node/npx.cmd')));
execFileSync(process.execPath, [join(root, 'node/node_modules/npm/bin/npm-cli.js'), '--version'], { windowsHide: true });
// Exercise the prebuilt native modules while no developer tool directory is on PATH.
process.env.PATH = `${join(root, 'node')};${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`;
require('koffi');
require('node-pty');
const sharp = require('sharp');
assert.ok((await sharp({ create: { width: 1, height: 1, channels: 3, background: '#123456' } }).png().toBuffer()).length > 0);
const { rgPath } = await import(pathToFileURL(join(modules, '@vscode/ripgrep/lib/index.js')).href);
execFileSync(rgPath, ['--version'], { windowsHide: true });
const scratch = await mkdtemp(join(resolve(root, '../'), 'verify-'));
const project = join(scratch, 'project');
await mkdir(project);
const { DeepSeekHarness } = await import(pathToFileURL(join(modules, '@deepseek-ai/dsh-sdk-client/lib/index.js')).href);
const harness = new DeepSeekHarness({
  dshBin: join(modules, '@deepseek-ai/dsh/lib/bin.js'), cwd: project, processCwd: project,
  initializeTimeoutMs: 30000, requestTimeoutMs: 30000,
  env: { ...process.env, DSH_HOME: join(scratch, 'home'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'unused-local-distribution-check', DEEPSEEK_BASE_URL: 'http://127.0.0.1:1' },
});
try { await harness.start(); } finally { await harness.close(); }
console.log(`Distribution verified: Node ${process.version}; native modules, ripgrep and SDK handshake; ${files} files; no symlinks. No model API called.`);
