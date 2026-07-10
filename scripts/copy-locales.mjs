// Cross-platform replacement for `cp -r src/locales dist/`.
// The previous build used a POSIX `cp`, which fails on Windows shells.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'src/locales');
const dest = resolve(root, 'dist/locales');

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`[build] Copied locales -> ${dest}`);
