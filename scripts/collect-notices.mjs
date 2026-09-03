import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(process.argv[2]);
const destination = process.argv[3] ? resolve(process.argv[3]) : join(runtime, 'licenses');
mkdirSync(destination, { recursive: true });
const sections = ['Third-party license texts and package inventory\nGenerated from installed, locked dependency packages.\n'];
const inventory = [];
const seen = new Set();
function notices(root, label, license, nested = false) {
  const texts = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /^(licen[cs]e|copying|copyright|notice|third[-_]party[-_]notices)([._-]|$)/i.test(entry.name)) {
      const path = join(root, entry.name);
      if (statSync(path).size < 2_000_000) texts.push(`--- ${entry.name} ---\n${readFileSync(path, 'utf8')}`);
    }
    if (nested && entry.isDirectory() && !['node_modules', '.git'].includes(entry.name)) notices(join(root, entry.name), `${label}/${entry.name}`, license, true);
  }
  if (texts.length) sections.push(`\n========== ${label} (${license || 'see package'}) ==========\n${texts.join('\n\n')}`);
  return texts.length;
}
function npmPackages(root, productionOnly) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || (productionOnly && entry.dev)) continue;
    const directory = join(root, path);
    if (!existsSync(join(directory, 'package.json'))) continue; // Other-platform optional package.
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const id = `${pkg.name}@${pkg.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    inventory.push({ ecosystem: 'npm', name: pkg.name, version: pkg.version, license: pkg.license, source: entry.resolved });
    if (!notices(directory, id, pkg.license, true)) {
      const readme = readdirSync(directory).find(name => /^readme(\.|$)/i.test(name));
      if (readme) sections.push(`\n========== ${id}: upstream README ==========\n${readFileSync(join(directory, readme), 'utf8')}`);
      else throw new Error(`Missing license text and README: ${id}`);
    }
  }
}
npmPackages(join(runtime, 'harness'), false);
npmPackages(repo, true);
const npm = JSON.parse(readFileSync(join(runtime, 'node/node_modules/npm/package.json'), 'utf8'));
notices(join(runtime, 'node/node_modules/npm'), `${npm.name}@${npm.version}`, npm.license, true);
const cargo = spawnSync('cargo', ['metadata', '--locked', '--offline', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc', '--manifest-path', join(repo, 'src-tauri/Cargo.toml')], { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
if (cargo.status !== 0) throw new Error(`Run after cargo check with the Rust build environment configured. ${cargo.stderr || cargo.error}`);
for (const pkg of JSON.parse(cargo.stdout).packages) {
  if (!pkg.source) continue;
  inventory.push({ ecosystem: 'cargo', name: pkg.name, version: pkg.version, license: pkg.license, source: pkg.repository });
  const directory = dirname(pkg.manifest_path);
  if (!notices(directory, `${pkg.name}@${pkg.version}`, pkg.license) && pkg.license_file) sections.push(readFileSync(resolve(directory, pkg.license_file), 'utf8'));
}
inventory.sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name));
sections.splice(1, 0, inventory.map(pkg => `${pkg.ecosystem}: ${pkg.name}@${pkg.version} | ${pkg.license || 'see supplied license'} | ${pkg.source || ''}`).join('\n'));
writeFileSync(join(destination, 'NOTICES.txt'), sections.join('\n\n'));
writeFileSync(join(destination, 'inventory.json'), JSON.stringify(inventory, null, 2));
writeFileSync(join(destination, 'NATIVE-SOURCES.md'), readFileSync(join(repo, 'distribution/NATIVE-SOURCES.md')));
for (const name of readdirSync(join(repo, 'distribution/licenses'))) copyFileSync(join(repo, 'distribution/licenses', name), join(destination, name));
const nativeNotices = join(runtime, '../source-archives/NATIVE-LIBRARY-NOTICES.txt');
if (!existsSync(nativeNotices)) throw new Error('Run prepare-native-sources.mjs before collecting final distribution notices');
copyFileSync(nativeNotices, join(destination, 'NATIVE-LIBRARY-NOTICES.txt'));
console.log(`Preserved notices for ${inventory.length} npm and Rust packages.`);
