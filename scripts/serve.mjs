import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, PUBLIC_FILES } from './standalone.mjs';
const args = process.argv.slice(2);
let port = 4180, directory = path.resolve(ROOT), limited = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = Number(args[++i]);
  else if (args[i] === '--dir') { directory = path.resolve(args[++i]); limited = false; }
  else throw new Error(`Unknown option: ${args[i]}`);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
const mime = { '.html':'text/html; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.csv':'text/csv; charset=utf-8', '.json':'application/json; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || 'index.html';
    if (name.includes('\\') || name.split('/').some(part => part.startsWith('.')) || (limited && !PUBLIC_FILES.includes(name))) { res.writeHead(404).end('Not found'); return; }
    const destination = path.resolve(directory, name);
    if (!destination.startsWith(directory + path.sep)) { res.writeHead(404).end(); return; }
    const resolved = await fs.realpath(destination);
    if (!resolved.startsWith((await fs.realpath(directory)) + path.sep)) { res.writeHead(404).end(); return; }
    const body = await fs.readFile(resolved);
    res.writeHead(200, { 'Content-Type': mime[path.extname(name)] ?? 'application/octet-stream',
      'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local preview: http://127.0.0.1:${port}/`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
