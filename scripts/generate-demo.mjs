import fs from 'node:fs/promises';
import { seededRandom } from '../src/lib/engine.mjs';
// Fully fictional data. Do not replace this generator with an actual account export.
const random = seededRandom(104729), rows = ['account_id,symbol,return_pct,closed_at'];
for (const [symbol, size] of [['BTC-USDT',120],['ETH-USDT',100],['SOL-USDT',110]]) {
  for (let i=0;i<size;i++) {
    const r=random()<.62 ? -(0.2+random()*4.8) : .1+random()*12.9;
    const date=new Date(Date.UTC(2000,0,1+i)).toISOString();
    rows.push(`demo,${symbol},${r.toFixed(6)},${date}`);
  }
}
await fs.writeFile(new URL('../examples/synthetic.csv',import.meta.url),rows.join('\n')+'\n');
console.log('Generated fictional example data.');
