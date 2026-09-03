import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(repo, 'distribution/native-sources.json');
const sources = JSON.parse(await readFile(manifestPath, 'utf8'));
const root = resolve(process.argv[2]);
const directory = join(root, 'sources');
await mkdir(directory, { recursive: true });
const record = process.argv.includes('--record');
async function hash(path) { const sum = createHash('sha256'); for await (const chunk of createReadStream(path)) sum.update(chunk); return sum.digest('hex'); }
const queue = [...sources];
const failures = [];
let verified = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const item = queue.shift();
    try {
      if (basename(item.file) !== item.file || !item.url.startsWith('https://')) throw new Error('Unsafe source descriptor');
      const path = join(directory, item.file);
      if (!existsSync(path)) {
        const response = await fetch(item.url, { signal: AbortSignal.timeout(180000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await pipeline(Readable.fromWeb(response.body), createWriteStream(`${path}.part`));
        await rename(`${path}.part`, path);
      }
      const actual = await hash(path);
      if (item.sha256 && actual !== item.sha256) throw new Error(`SHA256 mismatch: ${actual}`);
      if (!item.sha256 && !record) throw new Error('Unpinned source checksum');
      item.sha256 = actual;
      verified++;
      if (verified % 50 === 0) console.log(`Verified ${verified}/${sources.length} source archives`);
    } catch (error) { failures.push(`${item.file}: ${error.message}`); }
  }
}));
if (record) await writeFile(manifestPath, `${JSON.stringify(sources, null, 2)}\n`);
if (failures.length) throw new Error(failures.join('\n'));
const noticePath = join(root, 'NATIVE-LIBRARY-NOTICES.txt');
const noticeKey = createHash('sha256').update(JSON.stringify(sources)).update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
const marker = join(root, 'notices.sha256');
if (!existsSync(noticePath) || !existsSync(marker) || (await readFile(marker, 'utf8')).trim() !== noticeKey) {
  const notices = ['Native image library and linked Rust dependency copyright/license notices.\nExtracted without changing text from the checksum-verified corresponding source archives.\n'];
  for (const source of sources) {
    const path = join(directory, source.file);
    const entries = execFileSync('tar', ['-tf', path], { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }).split(/\r?\n/);
    let selected = entries.filter(name => !name.endsWith('/') && /(^|\/)(licen[cs]e([._-].*)?|copying([._-].*)?|copyright([._-].*)?|notice([._-].*)?|authors([._-].*)?|ftl\.txt)$/i.test(name));
    if (!selected.length) selected = entries.filter(name => /^[^/]+\/(README[^/]*|Cargo.toml)$/i.test(name));
    if (selected.length) notices.push(`\n========== ${source.file} ==========\n${selected.join('\n')}\n\n${execFileSync('tar', ['-xOf', path, ...selected], { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 })}`);
  }
  await writeFile(noticePath, notices.join('\n'));
  await writeFile(marker, noticeKey);
}
await writeFile(join(directory, 'SOURCES.json'), `${JSON.stringify(sources, null, 2)}\n`);
await writeFile(join(directory, 'README.md'), await readFile(join(repo, 'distribution/NATIVE-SOURCES.md')));
for (const name of readdirSync(join(repo, 'distribution/licenses'))) await writeFile(join(directory, name), await readFile(join(repo, 'distribution/licenses', name)));
const archive = join(root, 'native-image-sources-sharp-0.35.4.zip');
execFileSync('tar', ['-a', '-c', '-f', archive, '-C', root, 'sources'], { windowsHide: true });
console.log(`Source companion: ${archive}\n${verified} source archives verified.\nSHA256 ${await hash(archive)}`);
