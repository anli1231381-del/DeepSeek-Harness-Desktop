import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// Catch file!() / panic metadata that could disclose the builder's local directories.
const binary = readFileSync(process.argv[2]);
const roots = [process.cwd(), homedir(), process.env.CARGO_HOME, process.env.RUSTUP_HOME, process.env.CARGO_TARGET_DIR].filter(Boolean);
for (const root of roots) {
  const absolute = resolve(root);
  for (const path of new Set([absolute, absolute.replaceAll('\\', '/')])) {
    if (binary.includes(Buffer.from(path)) || binary.includes(Buffer.from(path, 'utf16le'))) {
      throw new Error('Release contains a local build directory. Rebuild through scripts/desktop.ps1 with path remapping enabled.');
    }
  }
}
console.log('Release path check passed.');
