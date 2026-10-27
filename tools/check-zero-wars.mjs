// Fictional World: how often does a year pass with no war at all? Unseeded
// (real dice), 12 seeds × --runs each, spread over the CPU cores. Fails if more
// than 10% of the runs have no new war. Also reports the largest share of the
// map at the end of each run (information: a few percent of unseeded runs end
// above 30%, through a whole small nation conquered or expansionists settling
// unclaimed land; the seeded `npm run balance` holds the ~30% target).
//   node tools/check-zero-wars.mjs [--runs=8] [--months=12]
// Part of `npm test` (about half a minute on 4 cores).
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const SEEDS = ['SIM-0001', 'ABCD-1234', 'KRAKEN-7', 'VOLT-42', 'MIRA-9', 'OAK-3', 'EMBER-11', 'NORTH-5', 'TIDE-88', 'QUILL-21', 'RAVEN-6', 'SALT-404'];
const MAX_ZERO = 0.10;

if (opt('worker', null)) {
  // One seed, several runs: print one JSON line.
  const { simulate } = await import('./sim-ai.mjs');
  const { getEra } = await import('../js/eras.js');
  process.env.SEED = opt('worker');
  const out = [];
  for (let i = 0; i < Number(opt('runs', 8)); i++) {
    const r = simulate(getEra('fictional'), { months: Number(opt('months', 12)), quiet: true });
    const own = new Map();
    for (const p of r.state.provinces) if (p.owner >= 0) own.set(p.owner, (own.get(p.owner) ?? 0) + 1);
    out.push({ wars: r.events.newWars.length, share: Math.max(...own.values()) / r.state.provinces.length });
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}

const runs = Number(opt('runs', 8));
const months = Number(opt('months', 12));
const self = fileURLToPath(import.meta.url);
const queue = [...SEEDS];
const results = {};
const worker = () => new Promise((done) => {
  const next = () => {
    const seed = queue.shift();
    if (!seed) { done(); return; }
    const p = spawn(process.execPath, [self, `--worker=${seed}`, `--runs=${runs}`, `--months=${months}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    p.stdout.on('data', (d) => { text += d; });
    p.on('close', () => { results[seed] = JSON.parse(text.trim().split('\n').pop()); next(); });
  };
  next();
});
const t0 = Date.now();
await Promise.all(Array.from({ length: Math.max(1, Math.min(cpus().length, SEEDS.length)) }, worker));
const all = SEEDS.flatMap((s) => results[s]);
console.log(`Fictional World, ${months} months, ${runs} unseeded runs per seed (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
for (const s of SEEDS) console.log(`  ${s.padEnd(10)} wars ${results[s].map((r) => String(r.wars).padStart(2)).join(' ')}   largest ${results[s].map((r) => `${(100 * r.share).toFixed(0)}%`).join(' ')}`);
const zero = all.filter((r) => r.wars === 0).length;
const over30 = all.filter((r) => r.share > 0.30).length, worst = Math.max(...all.map((r) => r.share));
const zeroOk = zero / all.length <= MAX_ZERO;
console.log(`${zeroOk ? 'ok  ' : 'FAIL'} zero-war runs: ${zero}/${all.length} (${(100 * zero / all.length).toFixed(1)}%, limit ${MAX_ZERO * 100}%)`);
console.log(`     largest share (information): worst ${(100 * worst).toFixed(1)}%, ${over30} of ${all.length} runs above 30%`);
process.exit(zeroOk ? 0 : 1);
