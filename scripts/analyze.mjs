import fs from 'node:fs/promises';
import path from 'node:path';
import { readRecords, filterRecords, publicAnalysisRows } from '../src/lib/records.mjs';
import { DEFAULTS, simulatePortfolio } from '../src/lib/engine.mjs';
import { statisticGroups } from '../src/lib/statistics.mjs';
import { ROOT, standalone } from './standalone.mjs';
const HELP = `Usage: npm run analyze -- --input local-data/trades.csv [options]

  --account NAME          Select one account; required for multi-account files
  --all-accounts          Explicitly combine all accounts
  --symbols BTC,ETH,SOL   Exact symbols or base families; quote pairs stay separate
  --paths 10000           Simulations per asset (100–20000)
  --seed 20261023         Reproducible random seed
  --count-tolerance 0.2   Relative histogram count tolerance (0–1)
  --win-tolerance 0.05    Absolute win-rate tolerance (0–1)
  --risk-floor 0.5        Breach threshold as fraction of initial capital
  --output PATH          Default: local-output/report.html
  --summary PATH         Optional JSON with the 32 metrics per asset
  --force                Overwrite explicitly selected output files
  --help                 Show help

Inputs, generated reports and summaries are local private data; do not commit them.
`;
async function main() {
  const args = process.argv.slice(2), values = {}, options = { ...DEFAULTS };
  const numeric = { '--paths':'paths', '--seed':'seed', '--count-tolerance':'countTolerance', '--win-tolerance':'winTolerance', '--risk-floor':'riskFloor' };
  const flags = new Set(['--input','--account','--symbols','--output','--summary',...Object.keys(numeric)]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') { console.log(HELP); return; }
    if (arg === '--force' || arg === '--all-accounts') { values[arg] = true; continue; }
    if (!flags.has(arg) || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${arg}. Use --help.`);
    const value = args[++i];
    if (numeric[arg]) options[numeric[arg]] = Number(value); else values[arg] = value;
  }
  if (!values['--input']) throw new Error('Missing --input. Use --help.');
  if (values['--all-accounts'] && values['--account'] !== undefined) throw new Error('Choose --account or --all-accounts, not both.');
  const input = path.resolve(values['--input']), output = path.resolve(values['--output'] ?? path.join(ROOT,'local-output/report.html'));
  const summaryPath = values['--summary'] ? path.resolve(values['--summary']) : null;
  if (input === output || input === summaryPath || output === summaryPath) throw new Error('Input and output paths must be different.');
  for (const file of [output, summaryPath].filter(Boolean)) {
    if (!values['--force']) {
      try { await fs.access(file); throw new Error('Output already exists; use --force to overwrite.'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
  const stat = await fs.stat(input);
  if (stat.size > 30*1024*1024) throw new Error('Input exceeds 30 MB.');
  const records = readRecords(await fs.readFile(input,'utf8'), path.extname(input).toLowerCase()==='.json'?'json':'csv');
  const selected = publicAnalysisRows(filterRecords(records, {
    account: values['--all-accounts'] ? null : values['--account'],
    symbols: values['--symbols']?.split(',').map(s=>s.trim()).filter(Boolean),
  }));
  const results = simulatePortfolio(selected, options);
  const html = await standalone({ initialRows: selected, options, synthetic: false });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output,html);
  if (summaryPath) {
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath,JSON.stringify({ options, assets:results.map(r=>({symbol:r.symbol,summary:r.summary,statistics:statisticGroups(r)})) },null,2));
  }
  console.log(`Generated ${results.length} asset(s), ${selected.length} trades, ${options.paths} paths per asset.`);
  console.log(`Local report: ${output}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
