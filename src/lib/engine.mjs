export const BINS = [
  '≤−10%', '−10～−5%', '−5～−3%', '−3～−1%', '−1～0%', '0%',
  '0～1%', '1～3%', '3～5%', '5～10%', '≥10%',
];
export const DEFAULTS = Object.freeze({ paths: 10000, seed: 20261023,
  countTolerance: .2, winTolerance: .05, riskFloor: .5 });
export const MAX_PATH_STEPS = 3_000_000;
export const MAX_TOTAL_STEPS = 6_000_000;

export function binIndex(r) {
  if (r <= -10) return 0;
  if (r <= -5) return 1;
  if (r <= -3) return 2;
  if (r <= -1) return 3;
  if (r < 0) return 4;
  if (r === 0) return 5;
  if (r < 1) return 6;
  if (r < 3) return 7;
  if (r < 5) return 8;
  if (r < 10) return 9;
  return 10;
}
export function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const x = (sorted.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}
export function validateOptions(options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (!Number.isInteger(o.paths) || o.paths < 100 || o.paths > 20000) throw new Error('模拟条数必须是100–20,000之间的整数。');
  if (!Number.isInteger(o.seed) || o.seed < 0 || o.seed > 4294967295) throw new Error('随机种子必须是0–4,294,967,295之间的整数。');
  for (const key of ['countTolerance', 'winTolerance', 'riskFloor']) {
    if (!Number.isFinite(o[key]) || o[key] < 0 || o[key] > 1) throw new Error(`${key} 必须介于0和1之间。`);
  }
  return o;
}

// Conditional multinomial sampling with exact integer limits.
// The probability of a count vector is proportional to ∏ p_i^c_i / c_i!.
// Split positive/non-positive bins, convolve bounded per-bin polynomials,
// sample the total wins, then conditionally sample the counts in each group.
// This avoids enumerating an exponentially growing set of complete vectors.
function groupPolynomial(indices, hist, lower, upper, n, logFact) {
  const weights = indices.map(i => {
    if (!hist[i]) return new Float64Array([1]);
    const logs = Array.from({ length: upper[i] - lower[i] + 1 }, (_, e) =>
      (lower[i] + e) * Math.log(hist[i] / n) - logFact[lower[i] + e]);
    const shift = Math.max(...logs);
    return Float64Array.from(logs, w => Math.exp(w - shift));
  });
  const suffix = Array(indices.length + 1);
  suffix[indices.length] = new Float64Array([1]);
  for (let k = indices.length - 1; k >= 0; k--) {
    const a = weights[k], b = suffix[k + 1], next = new Float64Array(a.length + b.length - 1);
    if (a.length * b.length > 30_000_000) throw new Error('样本与计数容差组合过大，请减少交易笔数或缩小容差。');
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) next[i + j] += a[i] * b[j];
    let max = 0;
    for (const value of next) max = Math.max(max, value);
    if (!max) throw new Error('计数分布数值下溢，请缩小数据或约束范围。');
    for (let i = 0; i < next.length; i++) next[i] /= max;
    suffix[k] = next;
  }
  const base = indices.reduce((s, i) => s + lower[i], 0);
  function sample(total, random, output) {
    let remain = total - base;
    for (let k = 0; k < indices.length; k++) {
      const atom = weights[k], tail = suffix[k + 1];
      const lo = Math.max(0, remain - tail.length + 1), hi = Math.min(atom.length - 1, remain);
      let mass = 0;
      for (let e = lo; e <= hi; e++) mass += atom[e] * tail[remain - e];
      if (!(mass > 0)) throw new Error('没有可抽样的计数组合。');
      let draw = random() * mass, chosen = hi;
      for (let e = lo; e <= hi; e++) {
        draw -= atom[e] * tail[remain - e];
        if (draw < 0) { chosen = e; break; }
      }
      output[indices[k]] = lower[indices[k]] + chosen;
      remain -= chosen;
    }
    if (remain !== 0) throw new Error('区间计数未能守恒。');
  }
  return { base, mass: suffix[0], sample };
}
export function prepareSampler(returns, options = {}) {
  const o = validateOptions(options), n = returns.length;
  if (!n || n > 10000) throw new Error('每个币种需要1–10,000笔有效交易。');
  if (n * o.paths > MAX_PATH_STEPS) throw new Error(`每币种交易笔数×模拟条数不能超过${MAX_PATH_STEPS.toLocaleString()}；请减少模拟条数。`);
  const pools = BINS.map(() => []);
  for (const r of returns) {
    if (!Number.isFinite(r) || r <= -100) throw new Error('单笔收益率必须为有限数且大于−100%；当前模型不处理单笔归零或负权益。');
    pools[binIndex(r)].push(r);
  }
  const hist = pools.map(p => p.length);
  const lower = hist.map(c => Math.max(0, Math.ceil(c * (1 - o.countTolerance) - 1e-10)));
  const upper = hist.map(c => Math.floor(c * (1 + o.countTolerance) + 1e-10));
  const maxUpper = Math.max(...upper), logFact = new Float64Array(maxUpper + 1);
  for (let i = 1; i <= maxUpper; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  const positive = groupPolynomial([6, 7, 8, 9, 10], hist, lower, upper, n, logFact);
  const nonPositive = groupPolynomial([0, 1, 2, 3, 4, 5], hist, lower, upper, n, logFact);
  const wins = hist.slice(6).reduce((s, c) => s + c, 0), winRate = wins / n;
  const winMin = Math.max(0, Math.ceil((winRate - o.winTolerance) * n - 1e-10));
  const winMax = Math.min(n, Math.floor((winRate + o.winTolerance) * n + 1e-10));
  const choices = [];
  let total = 0;
  for (let w = winMin; w <= winMax; w++) {
    const mass = (positive.mass[w - positive.base] ?? 0) * (nonPositive.mass[n - w - nonPositive.base] ?? 0);
    if (mass > 0) { total += mass; choices.push({ wins: w, mass, cdf: total }); }
  }
  if (!choices.length || !Number.isFinite(total)) throw new Error('无法同时满足笔数和胜率限制。');
  for (const c of choices) c.cdf /= total;
  choices.at(-1).cdf = 1;
  function sampleCounts(random) {
    const u = random();
    const w = choices.find(c => u < c.cdf)?.wins ?? choices.at(-1).wins;
    const counts = Array(BINS.length).fill(0);
    positive.sample(w, random, counts);
    nonPositive.sample(n - w, random, counts);
    return counts;
  }
  return { pools, hist, lower, upper, winRatePct: winRate * 100,
    winMinPct: Math.max(0, (winRate - o.winTolerance) * 100),
    winMaxPct: Math.min(100, (winRate + o.winTolerance) * 100),
    feasibleWinMinPct: choices[0].wins / n * 100,
    feasibleWinMaxPct: choices.at(-1).wins / n * 100,
    winChoices: choices, sampleCounts };
}
export function equity(returns, riskFloor = .5) {
  let capital = 1, peak = 1, maxDrawdownPct = 0, minCapitalMultiple = 1;
  let firstBreachTrade = null, longestLosingStreak = 0, streak = 0;
  let positive = 0, negative = 0, wins = 0, losses = 0;
  const curve = [0];
  for (const r of returns) {
    capital *= 1 + r / 100;
    if (!Number.isFinite(capital)) throw new Error('复投净值溢出，请缩小样本或检查收益率单位。');
    peak = Math.max(peak, capital);
    maxDrawdownPct = Math.max(maxDrawdownPct, (1 - capital / peak) * 100);
    minCapitalMultiple = Math.min(minCapitalMultiple, capital);
    if (capital < riskFloor && firstBreachTrade === null) firstBreachTrade = curve.length;
    streak = r < 0 ? streak + 1 : 0;
    longestLosingStreak = Math.max(streak, longestLosingStreak);
    if (r > 0) { positive += r; wins++; }
    if (r < 0) { negative -= r; losses++; }
    curve.push((capital - 1) * 100);
  }
  return { returns, curve, terminalReturnPct: curve.at(-1), maxDrawdownPct, minCapitalMultiple,
    firstBreachTrade, longestLosingStreak, winRatePct: wins / returns.length * 100,
    payoffRatio: wins && losses ? (positive / wins) / (negative / losses) : null };
}
export function summarize(simulations, original, riskFloor = .5) {
  const size = simulations.length;
  const sorted = [...simulations].sort((a, b) => a.terminalReturnPct - b.terminalReturnPct);
  const terminal = sorted.map(p => p.terminalReturnPct);
  const dd = simulations.map(p => p.maxDrawdownPct).sort((a, b) => a - b);
  const streaks = simulations.map(p => p.longestLosingStreak).sort((a, b) => a - b);
  const winRates = simulations.map(p => p.winRatePct).sort((a, b) => a - b);
  const ratios = simulations.map(p => p.payoffRatio).filter(Number.isFinite).sort((a, b) => a - b);
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const count = predicate => simulations.filter(predicate).length;
  const meanReturn = mean(terminal), lossCount = count(p => p.terminalReturnPct < 0);
  const breachCount = count(p => p.firstBreachTrade !== null);
  return { p5: quantile(terminal, .05), median: quantile(terminal, .5), p95: quantile(terminal, .95),
    meanReturn, returnStdDev: Math.sqrt(mean(terminal.map(v => (v - meanReturn) ** 2))),
    worstReturn: terminal[0], bestReturn: terminal.at(-1), worst5Mean: mean(terminal.slice(0, Math.ceil(size * .05))),
    lossCount, profitCount: count(p => p.terminalReturnPct > 0), breachCount,
    terminalBreachCount: count(p => p.curve.at(-1) / 100 + 1 < riskFloor),
    loss20Count: count(p => p.terminalReturnPct <= -20), doublingCount: count(p => p.terminalReturnPct >= 100),
    beatHistoricalCount: count(p => p.terminalReturnPct > original.terminalReturnPct),
    drawdown20Count: count(p => p.maxDrawdownPct >= 20), drawdown30Count: count(p => p.maxDrawdownPct >= 30),
    drawdown50Count: count(p => p.maxDrawdownPct >= 50),
    lossFrequency: lossCount / size * 100, breachFrequency: breachCount / size * 100,
    drawdownMean: mean(dd), drawdownMedian: quantile(dd, .5), drawdownP95: quantile(dd, .95),
    drawdownP99: quantile(dd, .99), worstDrawdown: dd.at(-1), bestDrawdown: dd[0],
    winRateMean: mean(winRates), winRateMin: winRates[0], winRateMax: winRates.at(-1),
    payoffRatioMedian: ratios.length ? quantile(ratios, .5) : null,
    losingStreakMedian: quantile(streaks, .5), losingStreakP95: streaks[Math.ceil(size * .95) - 1],
    losingStreakMax: streaks.at(-1),
    worstMinCapitalPct: Math.min(...simulations.map(p => p.minCapitalMultiple)) * 100,
    worstId: sorted[0].id, bestId: sorted.at(-1).id,
    worstDrawdownId: simulations.reduce((a, b) => b.maxDrawdownPct > a.maxDrawdownPct ? b : a).id,
    lowestCapitalId: simulations.reduce((a, b) => b.minCapitalMultiple < a.minCapitalMultiple ? b : a).id };
}
export function simulateAsset(records, options = {}) {
  const o = validateOptions(options), symbol = records[0]?.symbol ?? '';
  const returns = records.map(r => r.returnPct), sampler = prepareSampler(returns, o);
  const salt = [...symbol].reduce((s, c) => Math.imul(s, 31) + c.charCodeAt(0), 0);
  const random = seededRandom((o.seed + salt) >>> 0), simulations = [];
  for (let i = 0; i < o.paths; i++) {
    const counts = sampler.sampleCounts(random), sampled = [];
    counts.forEach((n, b) => {
      const pool = sampler.pools[b];
      for (let j = 0; j < n; j++) sampled.push(pool[Math.floor(random() * pool.length)]);
    });
    for (let j = sampled.length - 1; j > 0; j--) {
      const k = Math.floor(random() * (j + 1));
      [sampled[j], sampled[k]] = [sampled[k], sampled[j]];
    }
    simulations.push({ id: i + 1, counts, ...equity(sampled, o.riskFloor) });
  }
  const original = { id: 0, counts: sampler.hist, ...equity(returns, o.riskFloor) };
  const summary = summarize(simulations, original, o.riskFloor);
  const visibleIds = new Set([summary.worstId, summary.bestId, summary.worstDrawdownId, summary.lowestCapitalId]);
  const visibleCount = Math.min(148, o.paths);
  for (let i = 0; i < visibleCount; i++) visibleIds.add(1 + Math.floor(i * (o.paths - 1) / (visibleCount - 1)));
  return { symbol, paths: o.paths, seed: o.seed, options: o, simulations, original, summary,
    visibleIds: [...visibleIds],
    bins: BINS.map((label, i) => ({ label, originalCount: sampler.hist[i], lowerCount: sampler.lower[i], upperCount: sampler.upper[i] })),
    parameters: { count: returns.length, priceWinRatePct: sampler.winRatePct,
      permittedWinRateMinPct: sampler.winMinPct, permittedWinRateMaxPct: sampler.winMaxPct,
      feasibleWinRateMinPct: sampler.feasibleWinMinPct, feasibleWinRateMaxPct: sampler.feasibleWinMaxPct,
      firstClose: records[0]?.closedAt ?? null, lastClose: records.at(-1)?.closedAt ?? null } };
}
export function simulatePortfolio(records, options = {}, onProgress = () => {}) {
  if (!records.length) throw new Error('没有符合筛选条件的交易。');
  const o = validateOptions(options);
  if (records.length * o.paths > MAX_TOTAL_STEPS) throw new Error(`全部交易笔数×模拟条数不能超过${MAX_TOTAL_STEPS.toLocaleString()}；请减少条数或币种。`);
  const symbols = [...new Set(records.map(r => r.symbol))].sort((a,b)=>a.localeCompare(b,'en'));
  if (symbols.length > 12) throw new Error('一次最多分析12个交易对，请缩小币种范围。');
  return symbols.map((symbol, i) => {
    const asset = records.filter(r => r.symbol === symbol);
    const dated = asset.filter(r => r.closedAt != null);
    if (dated.length && dated.length !== asset.length) throw new Error('平仓时间部分缺失，不能可靠重建历史顺序。');
    const ordered = dated.length ? [...asset].sort((a, b) => a.closedAt.localeCompare(b.closedAt) || a.order - b.order) : asset;
    const result = simulateAsset(ordered, options);
    onProgress({ completed: i + 1, total: symbols.length, symbol });
    return result;
  });
}
