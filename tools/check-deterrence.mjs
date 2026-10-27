// Does the Deterrent (Cold War Nuclear Deterrent, Fictional Doomsday Deterrent)
// freeze wars once many nations have it? Runs the eras that have one for two
// game years, with and without the deterrent effect, and compares new wars per
// half-year against how many nations hold it. Fails if, in the second year, wars
// with the deterrent fall below 60% of wars without it. Unseeded: Modern has
// no deterrent, so its two halves show the noise (about ±40% with 4 runs).
// Step 11A result: with deterrents deterring everyone, wars dropped once most
// nations held one; now a deterrent only deters nations without one.
//   node tools/check-deterrence.mjs [--months=24] [--runs=4]
// Slow (several minutes, spread over the CPU cores): `npm run test:sim`.
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const months = Number(opt('months', 24)), runs = Number(opt('runs', 4));
const HALF = 182;

if (opt('worker', null)) {
  // One run: era[:seed], with or without the deterrent. Prints one JSON line.
  const { simulate } = await import('./sim-ai.mjs');
  const { getEra } = await import('../js/eras.js');
  const [eraId, seed] = opt('worker').split(':');
  const off = opt('deterrent', 'on') === 'off';
  if (seed) process.env.SEED = seed;
  const halves = [];
  let detIds = [];
  const r = simulate(getEra(eraId), {
    months, quiet: true,
    setup: (sim) => {
      detIds = sim.research.tree.filter((t) => t.effects.some((e) => 'deterrence' in e)).map((t) => t.id);
      const holds = (n) => detIds.some((id) => sim.research.of(n).done.has(id));
      sim.holds = holds;
      // "Without": the techs stay (same tree, same AI research path), the effect is gone.
      if (off) for (const t of sim.research.tree) t.effects = t.effects.filter((e) => !('deterrence' in e));
      sim.ai.state.events.on('war:declared', ({ b }) => {
        const h = halves[halves.length - 1];
        if (h) { h.wars++; if (sim.holds(b)) h.onHolder++; }
      });
    },
    onDay: ({ day, state, sim }) => {
      if (day % HALF === 0 && day + HALF <= months * 730 / 24) {
        const alive = state.nations.filter((n) => state.provinces.some((p) => p.owner === n.id));
        halves.push({ from: day, wars: 0, onHolder: 0, holders: alive.filter((n) => sim.holds(n.id)).length, alive: alive.length });
      }
    },
  });
  const own = new Map();
  for (const p of r.state.provinces) if (p.owner >= 0) own.set(p.owner, (own.get(p.owner) ?? 0) + 1);
  console.log(JSON.stringify({ halves, share: Math.max(...own.values()) / r.state.provinces.length }));
  process.exit(0);
}

const CASES = [['coldwar'], ['modern'], ['fictional:SIM-0001'], ['fictional:TIDE-88'], ['fictional:MIRA-9']].map(([k]) => k);
const jobs = [];
for (const c of CASES) for (const det of ['on', 'off']) for (let i = 0; i < runs; i++) jobs.push({ c, det, i });
const self = fileURLToPath(import.meta.url);
const t0 = Date.now();
const results = [];
const queue = [...jobs];
const worker = () => new Promise((done) => {
  const next = () => {
    const j = queue.shift();
    if (!j) { done(); return; }
    const p = spawn(process.execPath, [self, `--worker=${j.c}`, `--deterrent=${j.det}`, `--months=${months}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    p.stdout.on('data', (d) => { text += d; });
    p.on('close', () => { results.push({ ...j, ...JSON.parse(text.trim().split('\n').pop()) }); next(); });
  };
  next();
});
await Promise.all(Array.from({ length: Math.max(1, cpus().length) }, worker));
console.log(`Deterrent check: ${months} months, ${runs} runs each, with and without the deterrent effect (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
console.log('case                 deterrent  new wars per half-year            holders at each half-year     wars on holders');
let failures = 0;
for (const c of CASES) {
  const avg = (det) => {
    const rs = results.filter((r) => r.c === c && r.det === det);
    const n = Math.max(...rs.map((r) => r.halves.length));
    return Array.from({ length: n }, (_, k) => {
      const hs = rs.map((r) => r.halves[k]).filter(Boolean);
      return { wars: hs.reduce((t, h) => t + h.wars, 0) / hs.length, holders: hs.reduce((t, h) => t + h.holders, 0) / hs.length, alive: hs.reduce((t, h) => t + h.alive, 0) / hs.length, onHolder: hs.reduce((t, h) => t + h.onHolder, 0) / hs.length };
    });
  };
  const on = avg('on'), off = avg('off');
  for (const [det, hs] of [['on', on], ['off', off]]) {
    console.log(`${c.padEnd(20)} ${det.padEnd(9)}  ${hs.map((h) => h.wars.toFixed(1).padStart(5)).join(' ')}              ${hs.map((h) => `${h.holders.toFixed(1)}/${h.alive.toFixed(0)}`.padStart(8)).join(' ')}   ${hs.map((h) => h.onHolder.toFixed(1)).join(' ')}`);
  }
  const y2 = (hs) => hs.slice(2, 4).reduce((t, h) => t + h.wars, 0);
  const ratio = y2(off) > 0 ? y2(on) / y2(off) : 1;
  const ok = ratio >= 0.6 || y2(off) < 1;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c}: second-year wars with the deterrent ${y2(on).toFixed(1)} vs ${y2(off).toFixed(1)} without (${(100 * ratio).toFixed(0)}%)`);
}
process.exit(failures ? 1 : 0);
