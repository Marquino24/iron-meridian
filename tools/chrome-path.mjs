// The Chromium the browser tests and the flag build use: $CHROME, else the newest
// Playwright Chromium under /opt/pw-browsers (its folder name changes with versions).
import { readdirSync, existsSync } from 'node:fs';

export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = '/opt/pw-browsers';
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const d of dirs) for (const sub of ['chrome-linux64', 'chrome-linux']) {
    const p = `${base}/${d}/${sub}/chrome`;
    if (existsSync(p)) return p;
  }
  return undefined; // let Playwright find its own
}
