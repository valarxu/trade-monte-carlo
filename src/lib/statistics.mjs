// Display rows preserve numeric values, units and the exact probability numerator.
export function statisticGroups(result) {
  const s = result.summary, o = result.original;
  const floorPct = result.options.riskFloor * 100;
  const floorLabel = Number.isInteger(floorPct) ? String(floorPct) : floorPct.toFixed(1);
  const row = (metric, simulatedValue, historicalValue, definition, format = 'percent', extra = {}) =>
    ({ symbol: result.symbol, seed: result.seed, paths: result.paths, metric, simulatedValue,
      historicalValue, definition, format, ...extra });
  const probability = (metric, count, historicalCondition, definition) => row(metric,
    count / result.paths * 100, historicalCondition == null ? null : Number(historicalCondition), definition, 'probability', { eventCount: count });
  return [
    { id: 'returns', title: '最终收益分布', rows: [
      row('收益率中位数', s.median, o.terminalReturnPct, '50%的模拟最终收益率不高于该值。'),
      row('收益率平均值', s.meanReturn, o.terminalReturnPct, '全部模拟最终收益率的算术平均值。'),
      row('收益率 P5', s.p5, o.terminalReturnPct, '5%的模拟最终收益率不高于该值。'),
      row('收益率 P95', s.p95, o.terminalReturnPct, '95%的模拟最终收益率不高于该值。'),
      row('最差最终收益率', s.worstReturn, o.terminalReturnPct, '本批模拟的最低终值；不代表未来下限。'),
      row('最好最终收益率', s.bestReturn, o.terminalReturnPct, '本批模拟的最高终值；不代表未来上限。'),
      row('最终收益标准差', s.returnStdDev, null, '最终收益率的离散程度，单位为百分点。', 'points'),
      row('最差5%的平均收益', s.worst5Mean, null, '按最终收益排序，最差5%模拟的平均收益率。'),
    ] },
    { id: 'drawdown', title: '最大回撤分布', rows: [
      row('平均最大回撤', s.drawdownMean, o.maxDrawdownPct, '先算每条路径的最大回撤，再取平均。', 'unsigned'),
      row('最大回撤中位数', s.drawdownMedian, o.maxDrawdownPct, '各路径最大回撤的第50百分位。', 'unsigned'),
      row('最大回撤 P95', s.drawdownP95, o.maxDrawdownPct, '95%的模拟最大回撤不超过该值。', 'unsigned'),
      row('最大回撤 P99', s.drawdownP99, o.maxDrawdownPct, '99%的模拟最大回撤不超过该值。', 'unsigned'),
      row('最大回撤（最严重）', s.worstDrawdown, o.maxDrawdownPct, '全部模拟中最严重的一次峰值至谷值回撤。', 'unsigned'),
      row('最大回撤（最轻）', s.bestDrawdown, o.maxDrawdownPct, '全部模拟中最小的路径最大回撤。', 'unsigned'),
      probability('回撤达到20%的占比', s.drawdown20Count, o.maxDrawdownPct >= 20, '路径最大回撤≥20%的模拟数÷总模拟数。'),
      probability('回撤达到30%的占比', s.drawdown30Count, o.maxDrawdownPct >= 30, '路径最大回撤≥30%的模拟数÷总模拟数。'),
    ] },
    { id: 'outcomes', title: '亏损与资金触线概率', rows: [
      probability('最终亏损占比', s.lossCount, o.terminalReturnPct < 0, '最终净值<初始资金的模拟占比。'),
      probability('最终盈利占比', s.profitCount, o.terminalReturnPct > 0, '最终净值>初始资金的模拟占比；持平另计。'),
      probability(`爆仓占比（曾跌破${floorLabel}%）`, s.breachCount, o.firstBreachTrade !== null, `任意一笔后净值<初始资金${floorLabel}%，即计一次。`),
      probability(`期末仍低于初始${floorLabel}%`, s.terminalBreachCount, o.curve.at(-1)/100+1 < result.options.riskFloor, `最终净值<初始资金${floorLabel}%的模拟占比。`),
      probability('期末亏损至少20%', s.loss20Count, o.terminalReturnPct <= -20, '最终收益率≤−20%的模拟占比。'),
      probability('期末资金翻倍占比', s.doublingCount, o.terminalReturnPct >= 100, '最终收益率≥100%的模拟占比。'),
      probability('最终收益高于历史', s.beatHistoricalCount, null, '模拟最终收益率>红色历史顺序终值的占比。'),
      probability('回撤达到50%的占比', s.drawdown50Count, o.maxDrawdownPct >= 50, '从此前资金峰值回撤≥50%；区别于初始资金触线。'),
    ] },
    { id: 'trades', title: '逐笔表现与连续亏损', rows: [
      row('每条路径交易笔数', result.parameters.count, result.parameters.count, '全部路径与历史保持相同交易总笔数。', 'integer'),
      row('平均胜率', s.winRateMean, o.winRatePct, '各模拟价格收益率>0的交易占比，再取平均。', 'unsigned'),
      row('模拟实际胜率范围', s.winRateMin, o.winRatePct, '本批模拟实际出现的最低与最高胜率。', 'range', { upperValue: s.winRateMax }),
      row('盈亏比中位数', s.payoffRatioMedian, o.payoffRatio, '逐路径：平均盈利收益率÷平均亏损收益率绝对值，再取中位数。', 'ratio'),
      row('最长连亏笔数中位数', s.losingStreakMedian, o.longestLosingStreak, '先算每条路径最长连续亏损笔数，再取中位数。', 'trades'),
      row('最长连亏笔数 P95', s.losingStreakP95, o.longestLosingStreak, '95%的模拟最长连亏笔数不高于该值。', 'trades'),
      row('最长连亏（最严重）', s.losingStreakMax, o.longestLosingStreak, '全部模拟中出现的最长连续亏损段。', 'trades'),
      row('最低资金比例（最差）', s.worstMinCapitalPct, o.minCapitalMultiple * 100, '全部模拟中最低净值÷初始资金；越低表示本金损失越重。', 'unsigned'),
    ] },
  ];
}
