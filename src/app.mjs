import { DEFAULTS, simulatePortfolio } from './lib/engine.mjs';
import { readRecords, filterRecords, publicAnalysisRows } from './lib/records.mjs';
import { statisticGroups } from './lib/statistics.mjs';

const $ = id => document.getElementById(id);
const config = JSON.parse($('mc-config').textContent || '{}');
const state = { records: [], results: [], active: '', selected: {}, synthetic: false,
  source: '', busy: false, request: 0, worker: null, dirty: false };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const pct = (n, d = 1) => `${n > 0 ? '+' : ''}${n.toFixed(d)}%`;
const rate = (n, d = 2) => `${n.toFixed(d)}%`;
const num = n => n.toLocaleString('zh-CN');
const date = d => d ? d.slice(0, 10) : '按文件顺序';
let resizeFrame = 0, workerURL = null;

function message(text, busy = false) {
  $('status').innerHTML = `${busy ? '<i class="busy-dot" aria-hidden="true"></i>' : ''}${esc(text)}`;
}
function error(messageText = '') {
  $('error').textContent = messageText;
  $('error').hidden = !messageText;
}
function currentResult() { return state.results.find(r => r.symbol === state.active); }
function getOptions() {
  return { paths: Number($('paths').value), seed: Number($('seed').value),
    countTolerance: Number($('count-tolerance').value) / 100,
    winTolerance: Number($('win-tolerance').value) / 100, riskFloor: Number($('risk-floor').value) / 100 };
}
function applyOptions(options) {
  const o = { ...DEFAULTS, ...options };
  if (![...$('paths').options].some(v => Number(v.value) === o.paths)) $('paths').add(new Option(String(o.paths), String(o.paths)));
  $('paths').value = o.paths; $('seed').value = o.seed;
  $('count-tolerance').value = o.countTolerance * 100;
  $('win-tolerance').value = o.winTolerance * 100;
  $('risk-floor').value = o.riskFloor * 100;
}
function stop() {
  state.request++; state.worker?.terminate(); state.worker = null;
  if (workerURL) URL.revokeObjectURL(workerURL);
  workerURL = null; state.busy = false;
  $('run-button').disabled = false; $('reseed-button').disabled = false;
  $('cancel-button').hidden = true; $('result').removeAttribute('aria-busy');
}
function clearResults() {
  stop(); state.results = []; state.active = ''; state.selected = {};
  $('asset-tabs').replaceChildren();
  $('result').innerHTML = '<div class="empty">选择账户与币种，点击“开始模拟”。</div>';
}
function accountRows() {
  const value = $('account-select').value;
  if (value === 'choose') return [];
  return value === 'all' ? state.records : state.records.filter(r => r.accountId === JSON.parse(value));
}
function renderSymbolControls() {
  const symbols = [...new Set(accountRows().map(r => r.symbol))].sort((a,b)=>a.localeCompare(b,'en'));
  const preferred = symbols.filter(s => /^(BTC|ETH|SOL)(-|$)/.test(s));
  const defaults = new Set(preferred.length ? preferred : symbols.slice(0, 6));
  $('symbol-controls').innerHTML = '<legend>分析币种</legend>' + symbols.map((s, i) =>
    `<label><input type="checkbox" data-symbol="${esc(s)}" value="${esc(s)}" ${defaults.has(s) ? 'checked' : ''}>${esc(s)}</label>`).join('');
}
function installRecords(records, source, synthetic, initial = false) {
  clearResults(); state.records = records; state.source = source; state.synthetic = synthetic;
  const accounts = [...new Set(records.map(r => r.accountId ?? ''))];
  $('account-select').replaceChildren();
  if (accounts.length > 1) $('account-select').add(new Option('请选择账户', 'choose'));
  for (const a of accounts) $('account-select').add(new Option(a || '未分账户', JSON.stringify(a)));
  if (accounts.length > 1) $('account-select').add(new Option('合并全部账户（请确认策略一致）', 'all'));
  $('dataset-label').textContent = `${synthetic ? '合成示例 · 非真实交易' : '本地数据 · 不会上传'} · ${source} · ${num(records.length)} 笔记录`;
  renderSymbolControls();
  message(accounts.length > 1 ? `检测到${accounts.length}个账户，请选择后开始模拟。` : '数据已就绪。');
  error();
  if (initial && accounts.length === 1) run();
}
async function loadDemo() {
  stop(); error();
  try {
    // A generated offline report embeds its demo so it can be opened without a server.
    const text = config.demoCSV ?? await fetch('./examples/synthetic.csv').then(r => { if (!r.ok) throw new Error('示例载入失败。'); return r.text(); });
    installRecords(readRecords(text), 'synthetic.csv', true, true);
  } catch (e) { error(e.message); }
}
function run() {
  if (!$('run-form').reportValidity()) return;
  stop(); error();
  let rows, options;
  try {
    const symbols = [...$('symbol-controls').querySelectorAll('input:checked')].map(n => n.value);
    if (!symbols.length) throw new Error('请先选择账户和至少一个币种。');
    const accountValue = $('account-select').value;
    if (accountValue === 'choose') throw new Error('请先选择账户。');
    rows = publicAnalysisRows(filterRecords(state.records, {
      account: accountValue === 'all' ? null : JSON.parse(accountValue), symbols,
    }));
    options = getOptions();
  } catch (e) { error(e.message); return; }
  const request = ++state.request;
  state.busy = true; $('run-button').disabled = true; $('reseed-button').disabled = true;
  $('cancel-button').hidden = false; $('result').setAttribute('aria-busy', 'true');
  message('正在本地计算；可随时取消。', true);
  function finish(results) {
    if (request !== state.request) return;
    const old = state.active;
    stop(); state.results = results; state.dirty = false;
    state.active = results.some(r => r.symbol === old) ? old : results[0].symbol;
    state.selected = Object.fromEntries(results.map(r => [r.symbol, 1]));
    renderTabs(); renderAsset();
    message(`已完成 · 每币种 ${num(options.paths)} 条 · 种子 ${options.seed} · ${state.synthetic ? '合成示例' : '本地导入'} · 共 ${rows.length} 笔交易`);
  }
  function fail(text) { if (request === state.request) { stop(); error(text); message('计算未完成，请调整数据或参数。'); } }
  const fallback = () => setTimeout(() => {
    if (request !== state.request) return;
    try { finish(simulatePortfolio(rows, options)); } catch (e) { fail(e.message); }
  }, 40);
  try {
    if (config.workerSource) {
      workerURL = URL.createObjectURL(new Blob([config.workerSource], { type: 'text/javascript' }));
      state.worker = new Worker(workerURL, { type: 'module' });
    } else state.worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    state.worker.onmessage = ({ data }) => {
      if (data.id !== request || request !== state.request) return;
      if (data.error) fail(data.error);
      else if (data.results) finish(data.results);
      else if (data.progress) message(`已完成 ${data.progress.completed}/${data.progress.total} 个币种：${data.progress.symbol}`, true);
    };
    state.worker.onerror = e => {
      e.preventDefault(); state.worker?.terminate(); state.worker = null;
      message('后台线程不可用，改为浏览器本地计算。', true); fallback();
    };
    state.worker.postMessage({ id: request, rows, options });
  } catch { fallback(); }
}
function renderTabs() {
  $('asset-tabs').innerHTML = state.results.map(r => `<button role="tab" id="tab-${esc(r.symbol)}" aria-selected="${r.symbol === state.active}" aria-controls="result" data-tab="${esc(r.symbol)}" tabindex="${r.symbol === state.active ? 0 : -1}">${esc(r.symbol)}</button>`).join('');
}
function switchTab(symbol, keyboard = false) {
  state.active = symbol; renderTabs(); renderAsset();
  if (keyboard) $('asset-tabs').querySelector('[aria-selected=true]')?.focus();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function formatValue(value, row, historical = false) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (row.format === 'probability') return historical ? (value ? '是' : '否')
    : `${rate(value)}<small class="probability-count">${num(row.eventCount)} / ${num(row.paths)}</small>`;
  if (row.format === 'range') return historical ? rate(value) : `${rate(value)}–${rate(row.upperValue)}`;
  if (row.format === 'points') return `${value.toFixed(2)} 个百分点`;
  if (row.format === 'ratio') return `${value.toFixed(2)} 倍`;
  if (row.format === 'integer') return num(value);
  if (row.format === 'trades') return `${Number.isInteger(value) ? value : value.toFixed(1)} 笔`;
  if (row.format === 'unsigned') return rate(value);
  return pct(value, 2);
}
function renderAsset() {
  const r = currentResult();
  if (!r) return;
  const p = r.parameters, s = r.summary, floor = r.options.riskFloor * 100;
  const selected = r.simulations[(state.selected[r.symbol] ?? 1) - 1];
  const kpis = [
    ['历史顺序累计收益', pct(r.original.terminalReturnPct), 'red'],
    ['模拟收益率中位数', pct(s.median), ''], ['平均最大回撤', rate(s.drawdownMean, 1), ''],
    ['最大回撤（最严重）', rate(s.worstDrawdown, 1), ''], ['最终亏损占比', rate(s.lossFrequency), ''],
    [`爆仓占比 · 曾跌破初始${floor}%`, rate(s.breachFrequency), ''],
  ];
  $('result').setAttribute('aria-labelledby', `tab-${r.symbol}`);
  $('result').innerHTML = `
    <div class="result-top"><div><div class="eyebrow">${state.synthetic ? 'SYNTHETIC EXAMPLE' : 'LOCAL ANALYSIS'}</div><h2>${esc(r.symbol)} <span class="note">${p.count} 笔交易</span></h2><p>${esc(date(p.firstClose))}${p.lastClose ? ` 至 ${esc(date(p.lastClose))}` : ''} · 价格胜率 ${rate(p.priceWinRatePct)}</p></div><button data-action="download">下载32项统计 CSV</button></div>
    <div class="kpis">${kpis.map(([label, value, cls]) => `<div class="kpi"><span>${esc(label)}</span><strong class="${cls}">${value}</strong></div>`).join('')}</div>
    <div class="model-line"><span>区间笔数 ±${r.options.countTolerance * 100}%</span><span>胜率 ±${r.options.winTolerance * 100} 个百分点</span><span>1倍名义仓位逐笔复投</span><span>收益率 P5—P95：${pct(s.p5)} 至 ${pct(s.p95)}</span><span>全部 ${num(r.paths)} 条 · 种子 ${r.seed}</span></div>
    <div class="plot-grid"><section class="panel"><div class="panel-header"><h3>累计收益路径</h3><span>累计收益率 / 交易笔数</span></div><div class="legend"><span><i class="history"></i>历史顺序</span><span><i></i>模拟路径</span></div><div id="path-chart" class="chart-wrap"></div>
    <div class="plot-controls"><label>模拟编号 <input id="selected-path" aria-label="模拟编号" type="number" min="1" max="${r.paths}" value="${selected.id}"></label><button data-action="next">下一条</button><button data-action="worst">最差终值</button><button data-action="best">最好终值</button><button data-action="drawdown">最大回撤</button><button data-action="minimum">资金最低</button></div><p class="note">显示约150条，包含收益与风险极端样本。点击蓝线或输入编号可查看任意模拟；统计使用全部模拟。</p></section>
    <section class="panel"><div class="panel-header"><h3>单笔收益分布 · #${selected.id}</h3><span>交易笔数</span></div><div class="legend"><span><i class="history"></i>历史笔数</span><span><i></i>选中模拟</span></div><div id="histogram" class="chart-wrap"></div>
    <div class="selected-summary"><b>胜率 ${rate(selected.winRatePct)}</b><b>终值 ${pct(selected.terminalReturnPct)}</b><b>最大回撤 ${rate(selected.maxDrawdownPct)}</b><b>触及爆仓线：${selected.firstBreachTrade === null ? '否' : `第${selected.firstBreachTrade}笔`}</b></div>
    <details class="bounds"><summary>核对每个区间的笔数</summary><div class="table-scroll"><table><thead><tr><th>收益区间</th><th>历史</th><th>允许笔数</th><th>选中模拟</th></tr></thead><tbody>${r.bins.map((b, i) => `<tr><td>${b.label}</td><td>${b.originalCount}</td><td>${b.lowerCount}–${b.upperCount}</td><td>${selected.counts[i]}</td></tr>`).join('')}</tbody></table></div></details></section></div>
    <div class="constraint-line"><strong>每条路径同时满足全部约束</strong><span>胜率限制 ${rate(p.permittedWinRateMinPct)}–${rate(p.permittedWinRateMaxPct)}</span><span>整数约束下可达 ${rate(p.feasibleWinRateMinPct)}–${rate(p.feasibleWinRateMaxPct)}</span></div>
    <div class="statistics-intro"><h2>完整统计列表 <span class="note">32 项</span></h2><p class="note">统计使用全部 ${num(r.paths)} 条模拟。历史列仅是一条真实顺序的复算参考。爆仓按曾跌破初始资金${floor}%统计，之后恢复也不撤销标记；曲线继续计算。最大回撤从此前资金峰值计算。</p></div>
    <div class="statistics-grid">${statisticGroups(r).map(group => `<section class="panel"><div class="panel-header"><h3>${group.title}</h3></div><div class="table-scroll"><table aria-label="${esc(r.symbol)} ${group.title}"><thead><tr><th>指标</th><th>全部模拟</th><th>历史顺序参考</th><th>说明</th></tr></thead><tbody>${group.rows.map(row => `<tr><td>${esc(row.metric)}</td><td>${formatValue(row.simulatedValue, row)}</td><td>${formatValue(row.historicalValue, row, true)}</td><td>${esc(row.definition)}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>
    <p class="note">最差值、最好值和0%触线率只描述本批模拟。区间内仅抽取已发生的收益率，不覆盖历史之外的损失。收益标准差单位为百分点；盈亏比按单笔价格收益率计算。未计费用、杠杆、持仓期间浮亏及同时持仓。</p>`;
  drawCharts();
}
function selectPath(id, focusAction = '') {
  const r = currentResult(); if (!r) return;
  state.selected[r.symbol] = Math.max(1, Math.min(r.paths, Math.trunc(id) || 1));
  renderAsset();
  if (focusAction) $('result').querySelector(`[data-action="${focusAction}"]`)?.focus({ preventScroll: true });
}
function drawCharts() {
  const r = currentResult(); if (!r || !$('path-chart')) return;
  const selected = r.simulations[(state.selected[r.symbol] ?? 1) - 1];
  const ids = new Set([...r.visibleIds, selected.id]);
  const paths = r.simulations.filter(p => ids.has(p.id));
  const container = $('path-chart'), w = Math.max(260, container.clientWidth), h = window.innerWidth < 620 ? 330 : 350;
  const L = 52, R = 10, T = 16, B = 32, floor = (r.options.riskFloor - 1) * 100;
  let low = Math.min(0, floor), high = 0;
  for (const p of [...paths, r.original]) for (const v of p.curve) { low = Math.min(low, v); high = Math.max(high, v); }
  const pad = (high - low) * .06 || 1; low -= pad; high += pad;
  const x = i => L + i / r.parameters.count * (w - L - R);
  const y = v => T + (high - v) / (high - low) * (h - T - B);
  const line = p => p.curve.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const yt = Array.from({ length: 5 }, (_, i) => low + (high - low) * i / 4);
  const xt = [...new Set([0, .25, .5, .75, 1].map(p => Math.round(p * r.parameters.count)))];
  container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(r.symbol)}红色历史与蓝色模拟路径，选中${selected.id}">
    ${yt.map(v => `<line x1="${L}" x2="${w-R}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end" class="chart-axis">${Math.round(v)}%</text>`).join('')}
    <line x1="${L}" x2="${w-R}" y1="${y(0)}" y2="${y(0)}" class="reference-line"/>
    <line x1="${L}" x2="${w-R}" y1="${y(floor)}" y2="${y(floor)}" class="reference-line"/><text x="${L+4}" y="${y(floor)-6}" class="chart-axis">初始资金${r.options.riskFloor*100}%线</text>
    ${xt.map(i => `<text x="${x(i)}" y="${h-8}" text-anchor="middle" class="chart-axis">${i}</text>`).join('')}
    ${paths.map(p => `<path d="${line(p)}" class="curve"/>`).join('')}<path d="${line(selected)}" class="curve-selected"/><path d="${line(r.original)}" class="curve-history"/>
    ${selected.firstBreachTrade !== null ? `<circle cx="${x(selected.firstBreachTrade)}" cy="${y(selected.curve[selected.firstBreachTrade])}" r="4.5" fill="var(--blue)" stroke="var(--panel)"><title>第${selected.firstBreachTrade}笔首次触线</title></circle>` : ''}
    <line id="hover-line" y1="${T}" y2="${h-B}" class="reference-line" hidden/>
  </svg><div id="chart-tooltip" class="chart-tooltip" hidden></div>`;
  const svg = container.querySelector('svg'), tooltip = $('chart-tooltip');
  function point(e) {
    const b = svg.getBoundingClientRect();
    const px = (e.clientX - b.left) * w / b.width, py = (e.clientY - b.top) * h / b.height;
    const trade = Math.max(0, Math.min(r.parameters.count, Math.round((px - L) / (w - L - R) * r.parameters.count)));
    return { px, py, trade };
  }
  svg.addEventListener('pointermove', e => {
    const { px, trade } = point(e), cross = $('hover-line');
    cross.removeAttribute('hidden'); cross.setAttribute('x1', x(trade)); cross.setAttribute('x2', x(trade));
    tooltip.hidden = false; tooltip.style.left = `${Math.max(0, Math.min(w-180, px+10))}px`;
    tooltip.innerHTML = `<strong>第${trade}笔后</strong><span>历史顺序 <b class="red">${pct(r.original.curve[trade])}</b></span><span>模拟 #${selected.id} <b class="blue">${pct(selected.curve[trade])}</b></span>`;
  });
  svg.addEventListener('pointerleave', () => { tooltip.hidden = true; $('hover-line').setAttribute('hidden', ''); });
  svg.addEventListener('click', e => {
    const { py, trade } = point(e);
    if (!trade) return;
    let nearest = paths[0];
    for (const p of paths) if (Math.abs(y(p.curve[trade])-py) < Math.abs(y(nearest.curve[trade])-py)) nearest = p;
    selectPath(nearest.id);
  });
  drawHistogram(r, selected, h);
}
function drawHistogram(r, selected, h) {
  const container = $('histogram'), w = Math.max(260, container.clientWidth), L = 34, R = 8, T = 18, B = 56;
  const max = Math.max(1, ...r.bins.map(b => b.originalCount), ...selected.counts);
  const step = Math.max(1, Math.ceil(max/5)), top = step*5;
  const y = v => T + (top-v)/top*(h-T-B), group = (w-L-R)/r.bins.length, bar = group*.3;
  container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(r.symbol)}历史与选中模拟收益率柱状图">
    ${Array.from({ length: 6 }, (_, i) => i*step).map(v => `<line x1="${L}" x2="${w-R}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/><text x="${L-7}" y="${y(v)+4}" text-anchor="end" class="chart-axis">${v}</text>`).join('')}
    ${r.bins.map((b, i) => {
      const center = L+(i+.5)*group;
      return `<rect x="${center-bar-1}" y="${y(b.originalCount)}" width="${bar}" height="${y(0)-y(b.originalCount)}" rx="2" fill="var(--red)"><title>${b.label} 历史${b.originalCount}笔</title></rect><rect x="${center+1}" y="${y(selected.counts[i])}" width="${bar}" height="${y(0)-y(selected.counts[i])}" rx="2" fill="var(--blue)"><title>${b.label} 模拟${selected.counts[i]}笔，允许${b.lowerCount}–${b.upperCount}</title></rect><text x="${center}" y="${h-B+17}" text-anchor="end" transform="rotate(-35 ${center} ${h-B+17})" class="chart-axis">${b.label}</text>`;
    }).join('')}</svg>`;
}
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function downloadStats() {
  const r = currentResult(); if (!r) return;
  const headers = ['symbol','seed','paths','group','metric','simulated_value','format','event_count','historical_value','definition'];
  const lines = statisticGroups(r).flatMap(g => g.rows.map(row => [r.symbol,r.seed,r.paths,g.title,row.metric,row.format==='range' ? `${row.simulatedValue}..${row.upperValue}` : row.simulatedValue,row.format,row.eventCount ?? '',row.historicalValue,row.definition]));
  const csv = '\uFEFF'+[headers,...lines].map(a=>a.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href=url; a.download=`${r.symbol}-statistics.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('run-form').addEventListener('submit', e => { e.preventDefault(); run(); });
$('reseed-button').addEventListener('click', () => { $('seed').value=(Number($('seed').value)+1)>>>0; run(); });
$('cancel-button').addEventListener('click', () => { stop(); message('已取消，保留上一批结果。'); });
$('import-button').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 30*1024*1024) throw new Error('文件超过30 MB，请先缩小导出范围。');
    const rows = readRecords(await file.text(), file.name.toLowerCase().endsWith('.json')?'json':'csv');
    installRecords(rows, file.name, false, true);
  } catch (e) { error(e.message); }
  $('file-input').value='';
});
$('demo-button').addEventListener('click', loadDemo);
$('account-select').addEventListener('change', () => { clearResults(); renderSymbolControls(); message('账户已切换，请运行模拟。'); });
$('symbol-controls').addEventListener('change', () => { clearResults(); message('币种已更改，请运行模拟。'); });
$('run-form').addEventListener('input', () => { state.dirty=true; if (!state.busy) message('参数已更改；图表仍为上一批结果，点击开始模拟以更新。'); });
$('asset-tabs').addEventListener('click', e => { const tab=e.target.closest('[data-tab]'); if(tab) switchTab(tab.dataset.tab); });
$('asset-tabs').addEventListener('keydown', e => {
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
  e.preventDefault(); const i=state.results.findIndex(r=>r.symbol===state.active), n=state.results.length;
  const next=e.key==='Home'?0:e.key==='End'?n-1:(i+(e.key==='ArrowRight'?1:-1)+n)%n;
  switchTab(state.results[next].symbol,true);
});
$('result').addEventListener('click', e => {
  const action=e.target.closest('[data-action]')?.dataset.action, r=currentResult(); if(!action||!r) return;
  if(action==='download') return downloadStats();
  const map={next:(state.selected[r.symbol]??1)%r.paths+1,worst:r.summary.worstId,best:r.summary.bestId,drawdown:r.summary.worstDrawdownId,minimum:r.summary.lowestCapitalId};
  if(map[action]) selectPath(map[action],action);
});
$('result').addEventListener('change', e => { if(e.target.id==='selected-path') selectPath(Number(e.target.value)); });
$('theme-button').addEventListener('click', () => {
  const light=document.documentElement.dataset.theme!=='light'; document.documentElement.dataset.theme=light?'light':'dark';
  $('theme-button').textContent=light?'深色模式':'浅色模式';
});
window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame=requestAnimationFrame(drawCharts); });
applyOptions(config.options);
if(config.initialRows) installRecords(config.initialRows.map((r,i)=>({...r,accountId:'',order:r.order??i})), '本地生成报告', Boolean(config.synthetic), true);
else loadDemo();
