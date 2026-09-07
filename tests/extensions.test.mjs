import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExtensionManager, validateMcp } from '../runtime/extensions.mjs';

test('MCP rejects unsupported transport and URL credentials', () => {
  assert.throws(() => validateMcp({ name: 'demo', transport: 'sse', url: 'https://example.com' }));
  assert.throws(() => validateMcp({ name: 'demo', url: 'https://user:password@example.com/mcp' }));
  assert.throws(() => validateMcp({ name: 'demo', url: 'https://example.com/mcp?token=secret' }));
  assert.throws(() => validateMcp({ name: 'demo', command: 'node', args: 'server.js' }));
  assert.equal(validateMcp({ name: 'demo', command: 'node', args: ['server.js'] }).transport, 'stdio');
});

test('MCP persistence, project isolation, disable, and real patch schema', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'harness-extensions-'));
  try {
    const manager = await createExtensionManager({ stateDirectory: directory });
    const item = await manager.dispatch('mcp_save', { name: 'demo', command: 'node', args: ['server.js'], scope: 'project', projectPath: join(directory, 'project') });
    assert.equal((await manager.snapshot()).mcpServers.length, 0);
    const visible = (await manager.snapshot({ projectPath: join(directory, 'project') })).mcpServers[0];
    assert.equal(visible.status, 'saved'); assert.equal(visible.loaded, false); assert.equal(visible.encryptedSecret, undefined);
    const [file] = await manager.patchFiles({ projectPath: join(directory, 'project') });
    const patch = await readFile(file, 'utf8');
    assert.match(patch, /- insert:/); assert.match(patch, /failOnStartupError: true/); assert.match(patch, /env: !!js/);
    await manager.dispatch('mcp_toggle', { id: item.id, enabled: false });
    await manager.patchFiles({ projectPath: join(directory, 'project') }); assert.doesNotMatch(await readFile(file, 'utf8'), /mcp-client/);
    const reload = await createExtensionManager({ stateDirectory: directory });
    assert.equal((await reload.snapshot({ projectPath: join(directory, 'project') })).mcpServers[0].enabled, false);
    await reload.dispatch('mcp_remove', { id: item.id }); assert.equal((await reload.snapshot()).mcpServers.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const harnessPath = process.env.HARNESS_EXTENSION_TEST_RUNTIME || 'D:/deepseekharness/HarnessDesktop-App/runtime/harness/node_modules/@deepseek-ai/dsh';
let nativeAvailable = true; try { await access(join(harnessPath, '../dsh-skill-filesystem/lib/index.js')); } catch { nativeAvailable = false; }
test('native Skills catalog accepts valid bundle and removal preserves source', { skip: !nativeAvailable }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'harness-skills-'));
  try {
    const source = join(directory, 'source'); await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: sample\ndescription: Sample instructions\n---\nBody');
    const manager = await createExtensionManager({ stateDirectory: join(directory, 'state'), harnessPath });
    const skill = await manager.dispatch('skill_import', { path: source });
    assert.equal((await manager.snapshot()).skills[0].status, 'discovered');
    assert.equal((await manager.snapshot()).skills[0].loaded, false);
    await manager.dispatch('skill_toggle', { id: skill.id, enabled: false });
    const [patch] = await manager.patchFiles({}); assert.match(await readFile(patch, 'utf8'), /customSkillDirs: \[\]/);
    await manager.dispatch('skill_remove', { id: skill.id }); await access(join(source, 'SKILL.md'));
    await writeFile(join(source, 'SKILL.md'), 'Missing frontmatter');
    await assert.rejects(manager.dispatch('skill_import', { path: source }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
