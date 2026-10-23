# Project conventions

- Use Node.js built-ins and browser standards. The app must remain independent of local agents, proprietary dashboard runtimes, CDNs, and cloud credentials.
- Keep private inputs in `local-data/` and generated reports in `local-output/`. Never commit real accounts, real return sequences, screenshots of private data, or source hashes of private files.
- Only `examples/synthetic.csv` and `examples/raw-format.csv` may contain committed example rows. Both must remain fully fictional.
- Preserve the conditional multinomial count distribution, exact integer bounds, fixed trade counts, and win-rate constraints. Zero-return trades are non-winning trades.
- Risk breach means post-trade equity strictly below the selected fraction of initial capital. It is distinct from peak-to-trough maximum drawdown and does not stop the path.
- Run `npm run check` before committing. Use `scripts/check-privacy.mjs --deny-file` with a local, untracked marker list when publishing work involving real inputs.
