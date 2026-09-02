// vsce rewrites relative image paths in the packaged readme for the marketplace.
// A locally installed vsix renders README.md from disk, so restore the relative
// paths inside the package. Run straight after `vsce package`.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vsix = fs.readdirSync(ROOT).find((f) => f.endsWith('.vsix'));
if (!vsix) { console.error('no .vsix found — run vsce package first'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ruoste-'));
execFileSync('unzip', ['-q', path.join(ROOT, vsix), '-d', tmp]);
fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(tmp, 'extension', 'readme.md'));
fs.rmSync(path.join(ROOT, vsix));
execFileSync('zip', ['-q', '-r', '-X', path.join(ROOT, vsix),
  '[Content_Types].xml', 'extension.vsixmanifest', 'extension/'], { cwd: tmp });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${vsix} — restored relative README image paths`);
