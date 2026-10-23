import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, standalone } from './standalone.mjs';
await fs.mkdir(path.join(ROOT, 'dist'), { recursive: true });
await fs.writeFile(path.join(ROOT, 'dist/index.html'), await standalone());
console.log('Built dist/index.html — self-contained, synthetic example only.');
