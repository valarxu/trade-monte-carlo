import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT,standalone} from '../scripts/standalone.mjs';
test('offline build embeds modules, styles and fictional demo without CDN dependencies',async()=>{
  const html=await standalone();
  assert(!/<script[^>]+src=/.test(html));assert(!/<link[^>]+stylesheet/.test(html));
  assert(html.includes('data:text/javascript;base64,'));assert(html.includes('workerSource'));
  const config=JSON.parse(html.match(/<script id="mc-config" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert(config.synthetic);assert(config.demoCSV.includes('2000-'));assert(!config.initialRows);
});
test('CLI generates local report and summary, strips IDs, and refuses accidental overwrite',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mc-test-'));
  try{
    const input=path.join(directory,'trades.csv'),out=path.join(directory,'report.html'),summary=path.join(directory,'summary.json');
    await fs.writeFile(input,'account_id,record_id,symbol,return_pct\nexample-private,private-order-1,TEST,3\nexample-private,private-order-2,TEST,-1\n');
    const args=['scripts/analyze.mjs','--input',input,'--paths','100','--output',out,'--summary',summary];
    execFileSync(process.execPath,args,{cwd:ROOT,stdio:'pipe'});
    const html=await fs.readFile(out,'utf8');
    assert(!html.includes('example-private'));assert(!html.includes('private-order-1'));assert(!html.includes(input));
    const json=JSON.parse(await fs.readFile(summary,'utf8'));
    assert.equal(json.assets[0].statistics.flatMap(g=>g.rows).length,32);
    assert.throws(()=>execFileSync(process.execPath,args,{cwd:ROOT,stdio:'pipe'}));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
