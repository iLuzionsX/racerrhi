import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const donor = fileURLToPath(new URL('../.vendor/Racing26/', import.meta.url));
const patch = fileURLToPath(new URL('./patches/racing26-road-load-time.patch', import.meta.url));
const git = (...args) => execFileSync('git', ['-C', donor, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const pinned = 'abff9f452e4c2b22ac1220a1414418ace3f36e0a';
if (git('rev-parse', 'HEAD').trim() !== pinned) throw new Error('Unexpected Racing26 donor; review the suspension patch before changing the pin.');
try {
  git('apply', '--reverse', '--check', patch);
  console.log('Racing26 road-load timing patch already applied.');
} catch {
  git('apply', '--check', patch);
  git('apply', patch);
  console.log('Applied Racing26 road-load timing patch to pinned donor.');
}
