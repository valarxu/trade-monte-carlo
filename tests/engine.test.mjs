import test from 'node:test';
import assert from 'node:assert/strict';
import { binIndex, equity, prepareSampler, seededRandom, simulatePortfolio, validateOptions } from '../src/lib/engine.mjs';
import { statisticGroups } from '../src/lib/statistics.mjs';
const returns = [-4,-2,-1,-.3,0,.2,.6,1.2,2,4,7,11];
const rows = Array.from({length:72},(_,i)=>({symbol:'EXAMPLE-USDT',returnPct:returns[i%returns.length],closedAt:null,order:i}));

test('histogram endpoint definitions',()=>{
  assert.deepEqual([-10,-5,-3,-1,-.001,0,.001,1,3,5,10].map(binIndex),[0,1,2,3,4,5,6,7,8,9,10]);
});
test('strict initial-capital breach differs from peak drawdown and survives recovery',()=>{
  assert.equal(equity([-50]).firstBreachTrade,null);
  assert.equal(equity([-50.001]).firstBreachTrade,1);
  const recovered=equity([-60,200]);
  assert.equal(recovered.firstBreachTrade,1); assert(recovered.terminalReturnPct>0);
  const peak=equity([100,-50]);
  assert.equal(peak.maxDrawdownPct,50); assert.equal(peak.firstBreachTrade,null);
  assert.equal(equity([-26],.75).firstBreachTrade,1);
  assert.equal(equity([-10,-10,0,-10]).longestLosingStreak,2);
  assert.equal(equity([10,20,-5,-10]).payoffRatio,2);
});
test('dynamic programming matches enumerated conditional multinomial probabilities',()=>{
  const sample=[...Array(5).fill(-2),...Array(5).fill(-.5),...Array(5).fill(.5),...Array(5).fill(2)];
  const sampler=prepareSampler(sample,{paths:100,winTolerance:.05});
  const byWins=new Map(), byVector=new Map();
  const factorial=n=>Array.from({length:n},(_,i)=>i+1).reduce((a,b)=>a*b,1);
  let total=0;
  for(let a=4;a<=6;a++)for(let b=4;b<=6;b++)for(let c=4;c<=6;c++)for(let d=4;d<=6;d++){
    if(a+b+c+d!==20||c+d<9||c+d>11)continue;
    const vector=Array(11).fill(0);[3,4,6,7].forEach((bin,i)=>vector[bin]=[a,b,c,d][i]);
    const weight=[a,b,c,d].reduce((v,n)=>v*.25**n/factorial(n),1);
    total+=weight;byWins.set(c+d,(byWins.get(c+d)||0)+weight);byVector.set(vector.join(','),weight);
  }
  let previous=0;
  for(const choice of sampler.winChoices){assert(Math.abs(choice.cdf-previous-byWins.get(choice.wins)/total)<1e-12);previous=choice.cdf;}
  const random=seededRandom(1234), observed=new Map(), size=50000;
  for(let i=0;i<size;i++){const k=sampler.sampleCounts(random).join(',');assert(byVector.has(k));observed.set(k,(observed.get(k)||0)+1);}
  for(const [key,weight] of byVector)assert(Math.abs((observed.get(key)||0)/size-weight/total)<.012);
});
test('every simulated path obeys both bounds; all 32 metrics use the full batch',()=>{
  const [result]=simulatePortfolio(rows,{paths:1000,seed:42});
  for(const path of result.simulations){
    assert.equal(path.returns.length,rows.length);
    const counts=Array(11).fill(0);path.returns.forEach(r=>counts[binIndex(r)]++);
    assert.deepEqual(counts,path.counts);
    result.bins.forEach((b,i)=>assert(counts[i]>=b.lowerCount&&counts[i]<=b.upperCount));
    assert(Math.abs(path.winRatePct-result.original.winRatePct)<=5+1e-10);
    const capital=path.returns.reduce((v,r)=>v*(1+r/100),1);
    assert(Math.abs(path.terminalReturnPct-(capital-1)*100)<1e-10);
    const first=path.curve.findIndex(r=>1+r/100<.5);
    assert.equal(path.firstBreachTrade,first<0?null:first);
  }
  const groups=statisticGroups(result), metrics=groups.flatMap(g=>g.rows);
  assert.equal(metrics.length,32);assert.equal(new Set(metrics.map(r=>r.metric)).size,32);
  for(const r of metrics)if(r.format==='probability')assert.equal(r.simulatedValue,r.eventCount/1000*100);
  assert.equal(result.summary.breachCount,result.simulations.filter(p=>p.firstBreachTrade!==null).length);
  assert.equal(result.summary.worstDrawdown,Math.max(...result.simulations.map(p=>p.maxDrawdownPct)));
});
test('seed reproducibility, exact zero tolerance, all-zero and all-winning samples',()=>{
  const a=simulatePortfolio(rows,{paths:100,seed:12}),b=simulatePortfolio(rows,{paths:100,seed:12});
  assert.deepEqual(a,b);assert.notDeepEqual(a[0].simulations[0].returns,simulatePortfolio(rows,{paths:100,seed:13})[0].simulations[0].returns);
  const fixed=simulatePortfolio(rows,{paths:100,countTolerance:0,winTolerance:0})[0];
  fixed.simulations.forEach(p=>assert.deepEqual(p.counts,fixed.original.counts));
  for(const value of [0,1,-1]){
    const r=simulatePortfolio([{symbol:'TEST',returnPct:value}],{paths:100})[0];
    assert.equal(r.original.winRatePct,value>0?100:0);
    assert.equal(r.simulations[0].payoffRatio,null);
  }
});
test('reject invalid model parameters and capacity violations',()=>{
  assert.throws(()=>validateOptions({seed:-1}));assert.throws(()=>validateOptions({paths:99}));
  assert.throws(()=>validateOptions({winTolerance:NaN}));assert.throws(()=>prepareSampler([-100],{paths:100}));
  assert.throws(()=>prepareSampler(Array(1000).fill(1),{paths:10000}),/减少/);
  assert.throws(()=>simulatePortfolio([{symbol:'X',returnPct:1,closedAt:null},{symbol:'X',returnPct:1,closedAt:'2000-01-01T00:00:00Z'}],{paths:100}),/部分缺失/);
});
