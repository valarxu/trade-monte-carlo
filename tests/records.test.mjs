import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,readRecords,normalizeRecords,filterRecords,publicAnalysisRows} from '../src/lib/records.mjs';
test('CSV quoting, BOM, CRLF, escaped quotes and embedded newlines',()=>{
  const rows=parseCSV('\uFEFFsymbol,return_pct,note\r\nTEST,1,"a,""b""\nc"\r\n');
  assert.equal(rows[0].note,'a,"b"\nc');
  assert.throws(()=>parseCSV('a,a\n1,2'),/重复/);assert.throws(()=>parseCSV('a,b\n1'),/列数/);
  assert.throws(()=>parseCSV('a\n"open'),/未闭合/);assert.throws(()=>parseCSV('a\n"x"z'),/非法/);
});
test('return_pct means percent; price calculation respects long/short and ignores monetary fields',()=>{
  assert.equal(readRecords('symbol,return_pct\nTEST,1%')[0].returnPct,1);
  const r=normalizeRecords([
    {symbol:'test/usdt',direction:'long',open_price:100,close_price:110,realized_pnl:-99},
    {symbol:'TEST-USDT',direction:'short',open_price:100,close_price:110},
  ]);
  assert(Math.abs(r[0].returnPct-10)<1e-10);assert(Math.abs(r[1].returnPct+10)<1e-10);
  assert.throws(()=>normalizeRecords([{symbol:'X',return_pct:''}]),/缺失/);
  assert.throws(()=>normalizeRecords([{symbol:'X',return_pct:-100}]),/−100/);
  assert.throws(()=>normalizeRecords([{symbol:'X',return_pct:1,closed_at:'2000-01-01T12:00:00'}]),/时区/);
});
test('multi-account selection must be explicit and different quote pairs stay separate',()=>{
  const rows=normalizeRecords([
    {symbol:'BTC-USDT',return_pct:1,account_id:'example-a',record_id:'example-1'},
    {symbol:'BTC-USD',return_pct:2,account_id:'example-b',record_id:'example-2'},
  ]);
  assert.throws(()=>filterRecords(rows),/多个账户/);
  assert.equal(filterRecords(rows,{account:'example-a'}).length,1);
  assert.equal(filterRecords(rows,{account:null,symbols:['BTC']}).length,2);
  assert.notEqual(rows[0].symbol,rows[1].symbol);
  assert.deepEqual(Object.keys(publicAnalysisRows(rows)[0]),['symbol','returnPct','closedAt','order']);
  assert.throws(()=>normalizeRecords([{symbol:'X',return_pct:1,record_id:'same'},{symbol:'X',return_pct:2,record_id:'same'}]),/重复/);
});
test('JSON arrays and trades object are accepted; invalid JSON and symbols are rejected',()=>{
  assert.equal(readRecords('{"trades":[{"symbol":"TEST","return_pct":2}]}','json')[0].returnPct,2);
  assert.throws(()=>readRecords('{broken','json'),/JSON/);
  assert.throws(()=>normalizeRecords([{symbol:'<script>',return_pct:1}]),/交易对/);
});
