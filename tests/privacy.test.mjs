import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {privacyScan} from '../scripts/check-privacy.mjs';
test('privacy scan checks the actual Git index, even if the working file was sanitized',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mc-privacy-'));
  try {
    await fs.mkdir(path.join(root,'src'));
    const secret='/' + ['Users','example','private'].join('/') + '/';
    const filename=path.join(root,'src/example.mjs');
    await fs.writeFile(filename,JSON.stringify(secret));
    execFileSync('git',['init','-q'],{cwd:root});
    execFileSync('git',['add','src/example.mjs'],{cwd:root});
    await fs.writeFile(filename,'export const sample = true;');
    const audit=await privacyScan({root});
    assert(audit.errors.some(e=>e.includes('[index]')&&e.includes('absolute path')));
    execFileSync('git',['add','src/example.mjs'],{cwd:root});
    assert.deepEqual((await privacyScan({root})).errors,[]);
  }finally {await fs.rm(root,{recursive:true,force:true});}
});
