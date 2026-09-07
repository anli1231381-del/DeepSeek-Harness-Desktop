import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

async function main() {
  // Use current working directory as repo root to avoid URL path quirks on Windows
  const repoRoot = process.cwd();
  const src = path.join(repoRoot, 'src', 'migration.ts');
  const out = path.join(repoRoot, 'runtime', 'migration.js');
  const code = await fs.readFile(src, 'utf8');
  const result = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.Preserve } });
  // Ensure runtime output dir exists
  await fs.mkdir(path.dirname(out), { recursive: true });
  const header = `// AUTO-GENERATED - DO NOT EDIT. Generated from src/migration.ts\n`;
  await fs.writeFile(out, header + result.outputText, 'utf8');
  console.log('compiled', src, '->', out);
}

main().catch(err => { console.error(err); process.exit(1); });
