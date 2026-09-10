import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const donor = fileURLToPath(new URL('../.vendor/Racing26/', import.meta.url));
const patches = [
  fileURLToPath(new URL('./patches/racing26-road-load-time.patch', import.meta.url)),
  fileURLToPath(new URL('./patches/racing26-deep-slide-friction.patch', import.meta.url)),
  fileURLToPath(new URL('./patches/racing26-granular-contact.patch', import.meta.url)),
  fileURLToPath(new URL('./patches/racing26-granular-kinematics.patch', import.meta.url)),
  fileURLToPath(new URL('./patches/racing26-gravel-traction.patch', import.meta.url)),
];
const git = (...args) => execFileSync('git', ['-C', donor, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const pinned = 'abff9f452e4c2b22ac1220a1414418ace3f36e0a';
if (git('rev-parse', 'HEAD').trim() !== pinned) throw new Error('Unexpected Racing26 donor; review integration patches before changing the pin.');

// Patches now overlap: reversing one in isolation cannot establish whether the
// entire stack is already present. Rebuild the expected stack from the pinned
// files, accepting only pristine files or known intermediate patch versions.
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'racerrhi-donor-'));
try {
  const files=[...new Set(patches.flatMap(p=>[...fs.readFileSync(p,'utf8').matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m=>m[1])))];
  const versions=new Map(files.map(f=>[f,new Set()]));
  for(const f of files){const text=git('show',pinned+':'+f);fs.mkdirSync(path.dirname(path.join(scratch,f)),{recursive:true});fs.writeFileSync(path.join(scratch,f),text);versions.get(f).add(text);}
  execFileSync('git',['-C',scratch,'init','--quiet']);
  for(const patch of patches){execFileSync('git',['-C',scratch,'apply','--check',patch]);execFileSync('git',['-C',scratch,'apply',patch]);for(const f of files)versions.get(f).add(fs.readFileSync(path.join(scratch,f),'utf8'));}
  for(const f of files){if(!versions.get(f).has(fs.readFileSync(path.join(donor,f),'utf8')))throw Error('Unrecognized donor edits in '+f+'; refusing to overwrite them.');}
  for(const f of files)fs.writeFileSync(path.join(donor,f),fs.readFileSync(path.join(scratch,f)));
  console.log('Verified and applied complete Racing26 integration patch stack ('+patches.length+' patches).');
} finally {fs.rmSync(scratch,{recursive:true,force:true});}
