import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './standalone.mjs';
const allowedRoots = new Set(['src','scripts','tests','examples','docs','.github','index.html','README.md','AGENTS.md','.gitignore','.node-version','package.json','package-lock.json']);
export async function privacyScan({ deny = [], root = ROOT } = {}) {
  let files, indexed = false;
  try { files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean); indexed = true; }
  catch {
    files=[];
    async function walk(dir, prefix='') {
      for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
        const relative=prefix+entry.name;
        if(!prefix&&!allowedRoots.has(entry.name)) continue;
        if(entry.isDirectory()) await walk(path.join(dir,entry.name),relative+'/'); else files.push(relative);
      }
    }
    await walk(root);
  }
  const errors=[];
  for(const name of files) {
    if(!allowedRoots.has(name.split('/')[0])) errors.push(`${name}: unexpected public file`);
    if(/\.(csv|json|html|png|jpg|pdf|xlsx|zip)$/i.test(name) && !['index.html','package.json','package-lock.json','examples/synthetic.csv','examples/raw-format.csv'].includes(name)) errors.push(`${name}: data/report files are not permitted`);
    const full=path.join(root,name), stat=await fs.lstat(full);
    if(stat.isSymbolicLink()) { errors.push(`${name}: symlinks are not permitted`); continue; }
    const working=await fs.readFile(full,'utf8');
    const versions=[{text:working,label:name}];
    if(indexed) {
      const staged=execFileSync('git',['show',`:${name}`],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']});
      if(staged!==working) versions.push({text:staged,label:`${name} [index]`});
    }
    for(const {text,label} of versions) {
      if(/\/(?:Users|home)\/[A-Za-z0-9._-]+\//.test(text)) errors.push(`${label}: personal absolute path`);
      if(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text)) errors.push(`${label}: possible secret`);
      if(deny.some(value=>value&&text.includes(value))) errors.push(`${label}: private marker found`);
    }
  }
  return { files:files.length, errors };
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let deny=[];
  const index=process.argv.indexOf('--deny-file');
  if(index>=0) deny=JSON.parse(await fs.readFile(process.argv[index+1],'utf8'));
  const report=await privacyScan({deny});
  if(report.errors.length) { console.error(report.errors.join('\n')); process.exitCode=1; }
  else console.log(`Privacy scan passed: ${report.files} public files. No real inputs or generated reports included.`);
}
