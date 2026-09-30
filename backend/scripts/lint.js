// Syntax-checks every backend source file (the project has no bundler or type checker).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folders = ['config', 'db', 'http', 'lib', 'routes', 'services', 'scripts', 'test'];
const files = ['server.js', 'server-neon.js', 'schemas.js'];
for (const folder of folders) {
  for (const name of readdirSync(path.join(root, folder))) {
    const file = path.join(folder, name);
    if (name.endsWith('.js') && statSync(path.join(root, file)).isFile()) files.push(file);
  }
}
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    console.error(`✖ ${file}\n${error.stderr}`);
  }
}
console.log(failed ? `${failed} file(s) failed the syntax check.` : `✔ ${files.length} files passed the syntax check.`);
process.exitCode = failed ? 1 : 0;
