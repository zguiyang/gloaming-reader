import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'domains', 'ai', 'prompts');
const dest = join(root, 'dist', 'prompts');
const templateDirs = ['roles', 'scenes'];

if (!existsSync(src)) {
  console.error(`copy-prompts: missing ${src}`);
  process.exit(1);
}

for (const dir of templateDirs) {
  if (!existsSync(join(src, dir))) {
    console.error(`copy-prompts: missing ${join(src, dir)}`);
    process.exit(1);
  }
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of templateDirs) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
console.log(`copy-prompts: ${src}/{${templateDirs.join(',')}} → ${dest}`);
