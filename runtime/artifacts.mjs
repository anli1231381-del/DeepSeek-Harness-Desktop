import { readdir, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

const ignored = new Set(['.git', 'node_modules', '.dsh', '.venv', '__pycache__']);
export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function scanWorkspace(root, excluded = []) {
  const files = new Map();
  const exclusions = new Set(excluded.map(file => resolve(file)));
  let count = 0;
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
      const name = prefix + entry.name;
      const absolute = join(directory, entry.name);
      if (exclusions.has(resolve(absolute))) continue;
      if (entry.isDirectory()) { await visit(absolute, name + '/'); continue; }
      if (!entry.isFile()) continue;
      if (++count > 20000) throw new Error('目录超过 20000 个文件，未生成文件成果快照。');
      const info = await stat(absolute);
      let content = null;
      if (info.size <= 128 * 1024) {
        const buffer = await readFile(absolute);
        if (!buffer.includes(0)) content = buffer.toString('utf8');
      }
      files.set(name, { hash: await hashFile(absolute), content });
    }
  }
  await visit(root);
  return files;
}

export function collectArtifacts(before, after, execution, workspacePath) {
  const result = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(path), next = after.get(path);
    if (old?.hash === next?.hash) continue;
    const changeType = !old ? 'created' : !next ? 'deleted' : 'modified';
    // Full-file text comparison; binary and large files retain hashes without embedding content.
    const textDiff = (!old || old.content !== null) && (!next || next.content !== null);
    const removed = (old?.content || '').split('\n'), added = (next?.content || '').split('\n');
    const diff = textDiff ? `--- 修改前/${path}\n+++ 修改后/${path}\n${old ? removed.map(line => '-' + line).join('\n') : ''}\n${next ? added.map(line => '+' + line).join('\n') : ''}` : '二进制文件或文件超过 128 KB，不提供内嵌文本对比。';
    result.push({ id: 'a-' + randomUUID(), sessionId: execution.sessionId, executionId: execution.id, path, workspacePath, changeType, beforeHash: old?.hash || null, afterHash: next?.hash || null, diff, createdAt: new Date().toISOString() });
  }
  return result;
}
