import { simulatePortfolio } from './lib/engine.mjs';
self.onmessage = ({ data: { id, rows, options } }) => {
  try {
    const results = simulatePortfolio(rows, options, progress => self.postMessage({ id, progress }));
    self.postMessage({ id, results });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
