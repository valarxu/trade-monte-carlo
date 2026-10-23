export function parseCSV(text) {
  if (typeof text !== 'string') throw new Error('CSV必须是文本。');
  text = text.replace(/^\uFEFF/, '');
  const rows = [], row = [];
  let field = '', quoted = false, closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closedQuote = true; }
      else field += c;
    } else if (c === '"' && !field && !closedQuote) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closedQuote = false;
      if (c !== ',') {
        if (row.some(v => v.trim())) rows.push(row.splice(0)); else row.length = 0;
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else {
      if (closedQuote) {
        if (c === ' ' || c === '\t') continue;
        throw new Error('CSV引号后存在非法字符。');
      }
      if (c === '"') throw new Error('CSV字段中的引号必须成对转义。');
      field += c;
    }
  }
  if (quoted) throw new Error('CSV包含未闭合的引号。');
  row.push(field);
  if (row.some(v => v.trim())) rows.push(row);
  if (!rows.length) throw new Error('CSV为空。');
  const headers = rows.shift().map(h => h.trim());
  if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('CSV表头不能为空或重复。');
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`第${index + 2}行列数与表头不一致。`);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i].trim()]));
  });
}
const own = (r, key) => Object.prototype.hasOwnProperty.call(r, key);
const first = (r, keys) => keys.find(k => own(r, k));
function requiredNumber(value, label, line) {
  if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error(`第${line}行${label}缺失或不是有效数字。`);
  return Number(value);
}
export function normalizeSymbol(input) {
  const s = String(input ?? '').trim().toUpperCase().replace(/\//g, '-');
  if (!s || s.length > 40 || !/^[A-Z0-9._:-]+$/.test(s)) throw new Error('交易对名称只能包含字母、数字和 . _ : -。');
  // Keep quote and instrument suffixes: BTC-USDT and BTC-USD must not be merged.
  return s;
}
export function normalizeRecords(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('数据必须是包含交易记录的非空数组。');
  if (rows.length > 100000) throw new Error('一次最多导入100,000条记录，请先缩小数据范围。');
  const seen = new Set();
  return rows.map((row, order) => {
    const line = order + 2;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`第${line}行不是交易对象。`);
    const symbolKey = first(row, ['symbol', '交易对', '币种']);
    const symbol = normalizeSymbol(row[symbolKey]);
    const accountKey = first(row, ['account_id', 'accountId', '账户']);
    const accountId = String(accountKey ? row[accountKey] ?? '' : '').trim();
    const idKey = first(row, ['record_id', 'trade_id']);
    if (idKey && String(row[idKey] ?? '').trim()) {
      const key = `${accountId}\u0000${row[idKey]}`;
      if (seen.has(key)) throw new Error(`第${line}行记录ID重复，请先确认导出数据是否重复。`);
      seen.add(key);
    }
    const returnKey = first(row, ['return_pct', 'priceReturnPct', '收益率(%)', '收益率%']);
    let returnPct;
    if (returnKey) returnPct = requiredNumber(String(row[returnKey] ?? '').replace(/%$/, ''), '收益率', line);
    else {
      const open = requiredNumber(row.open_price, '开仓均价', line);
      const close = requiredNumber(row.close_price, '平仓均价', line);
      if (!(open > 0) || !(close > 0)) throw new Error(`第${line}行开平仓均价必须大于0。`);
      const direction = String(row.direction ?? '').trim().toLowerCase();
      const sign = ['long', '多', '多头'].includes(direction) ? 1 : ['short', '空', '空头'].includes(direction) ? -1 : 0;
      if (!sign) throw new Error(`第${line}行direction必须是long或short。`);
      returnPct = (close / open - 1) * 100 * sign;
    }
    if (returnPct <= -100) throw new Error(`第${line}行收益率≤−100%，不适用于当前1倍复投模型。`);
    const dateKey = first(row, ['closed_at', 'closedAt', '平仓时间']);
    let closedAt = null;
    if (dateKey) {
      const raw = String(row[dateKey] ?? '').trim();
      // Reject timezone-dependent date-times; date-only and explicitly zoned ISO are stable.
      if (!/^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$)/i.test(raw) || !Number.isFinite(Date.parse(raw))) {
        throw new Error(`第${line}行平仓时间无效；使用ISO日期或含时区的ISO时间。`);
      }
      closedAt = new Date(raw).toISOString();
    }
    return { symbol, returnPct, accountId, closedAt, order };
  });
}
export function readRecords(text, format = 'csv') {
  let raw;
  if (format.toLowerCase() === 'json') {
    try { raw = JSON.parse(text); } catch { throw new Error('JSON格式无效。'); }
    if (raw && !Array.isArray(raw)) raw = raw.trades;
  } else raw = parseCSV(text);
  return normalizeRecords(raw);
}
export function filterRecords(rows, { account, symbols } = {}) {
  let selected = rows;
  const accounts = [...new Set(rows.map(r => r.accountId))];
  if (account === undefined && accounts.length > 1) throw new Error('检测到多个账户，请明确选择账户或使用--all-accounts合并。');
  if (account !== undefined && account !== null) selected = selected.filter(r => r.accountId === account);
  if (symbols?.length) {
    const wanted = new Set(symbols.map(normalizeSymbol));
    selected = selected.filter(r => [...wanted].some(s => r.symbol === s || (!s.includes('-') && r.symbol.startsWith(s + '-'))));
  }
  if (!selected.length) throw new Error('没有符合账户和币种筛选条件的交易。');
  return selected;
}
export function publicAnalysisRows(rows) {
  // Deliberately drop account IDs, record IDs, monetary P&L and source filenames.
  return rows.map(({ symbol, returnPct, closedAt, order }) => ({ symbol, returnPct, closedAt, order }));
}
