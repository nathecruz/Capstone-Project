import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targets = [
  { target: path.join(projectRoot, '.env'), template: path.join(projectRoot, '.env.example') },
  { target: path.join(projectRoot, 'backend', '.env'), template: path.join(projectRoot, 'backend', '.env.example') },
];

const created = [];
for (const { target, template } of targets) {
  if (existsSync(target)) continue;
  if (!existsSync(template)) continue;
  copyFileSync(template, target);
  created.push(path.relative(projectRoot, target));
}

if (created.length === 0) {
  console.log('Environment files already exist; no changes made.');
  process.exit(0);
}

console.log(`Created the following environment files from their templates: ${created.join(', ')}`);
console.log('Update the placeholders with the real backend and deployment values before production release.');
