import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const PUBLIC_FILES = ['index.html', 'src/app.mjs', 'src/styles.css', 'src/worker.mjs',
  'src/lib/engine.mjs', 'src/lib/records.mjs', 'src/lib/statistics.mjs', 'examples/synthetic.csv'];
const read = name => fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
export async function standalone({ initialRows, options, synthetic = true } = {}) {
  const [index, css, app, worker, engine, records, stats, demoCSV] = await Promise.all([
    read('index.html'), read('src/styles.css'), read('src/app.mjs'), read('src/worker.mjs'),
    read('src/lib/engine.mjs'), read('src/lib/records.mjs'), read('src/lib/statistics.mjs'), read('examples/synthetic.csv'),
  ]);
  const modules = { './lib/engine.mjs': engine, './lib/records.mjs': records, './lib/statistics.mjs': stats };
  function inline(source) {
    for (const [name, content] of Object.entries(modules)) source = source.replaceAll(`'${name}'`, JSON.stringify(url(content)));
    return source;
  }
  const config = { initialRows, options, synthetic, demoCSV, workerSource: inline(worker) };
  const safeJSON = JSON.stringify(config).replace(/</g, '\\u003c');
  return index.replace('<link rel="stylesheet" href="./src/styles.css">', `<style>${css}</style>`)
    .replace('<script id="mc-config" type="application/json">{}</script>', `<script id="mc-config" type="application/json">${safeJSON}</script>`)
    .replace('<script type="module" src="./src/app.mjs"></script>', `<script type="module">${inline(app).replace(/<\/script/gi, '<\\/script')}</script>`);
}
