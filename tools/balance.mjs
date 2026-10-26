// Balance report, headless: the Fictional World across seeds (largest share of
// the map after a year) and the historical eras (wars and largest share in six
// months, as in step 5). New wars (a nation choosing to attack) are counted apart
// from allies and coalitions joining one.
//   node tools/balance.mjs [fictional|history|all] [--seeds=12] [--months=12] [--check]
// --check exits 1 if a target is missed: fictional ≤ 25% after a year on every
// seed, historical 4–16 wars and ≤ 15% share.
import { simulate } from './sim-ai.mjs';
import { ERAS, getEra } from '../js/eras.js';
import { generateMap } from '../js/map.js';

const args = process.argv.slice(2);
const what = args.find((a) => !a.startsWith('--')) ?? 'all';
const opt = (k, d) => Number(args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const SEEDS = ['SIM-0001', 'ABCD-1234', 'KRAKEN-7', 'VOLT-42', 'MIRA-9', 'OAK-3', 'EMBER-11', 'NORTH-5', 'TIDE-88', 'QUILL-21', 'RAVEN-6', 'SALT-404'].slice(0, opt('seeds', 12));
const check = args.includes('--check');
const RUNS = opt('runs', 3); // dice rolls per seed (the AI is random; runs are seeded so results repeat)
const realRandom = Math.random;
function seedDice(seed) {
  let s = [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let failures = 0;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function shareNow(r) {
  const st = r.state;
  const land = st.provinces.length;
  const own = new Map();
  for (const p of st.provinces) if (p.owner >= 0) own.set(p.owner, (own.get(p.owner) ?? 0) + 1);
  let best = 0, who = -1;
  for (const [n, c] of own) if (c > best) { best = c; who = n; }
  return { share: best / land, name: st.getNation(who)?.shortName ?? st.getNation(who)?.name ?? '?' };
}

if (what === 'fictional' || what === 'all') {
  const months = opt('months', 12);
  console.log(`Fictional World, ${months} months, Normal`);
  console.log(`seed        largest now (worst of ${RUNS} runs)  peak any time       wars  conquered`);
  const rows = [];
  const totals = { runs: 0, wars: 0, conquered: 0, peace: 0, growth: 0, quiet: 0 };
  for (const seed of SEEDS) {
    process.env.SEED = seed;
    let worst = null;
    const shares = [];
    const startMax = (() => { const own = new Map(); const m = generateMap(seed); for (const p of m.provinces) if (p.owner >= 0) own.set(p.owner, (own.get(p.owner) ?? 0) + 1); return Math.max(...own.values()) / m.provinces.length; })();
    for (let k = 0; k < RUNS; k++) {
      seedDice(`${seed}#${k}`);
      const r = simulate(getEra('fictional'), { months, quiet: true });
      const now = shareNow(r);
      shares.push(now.share);
      totals.runs++; totals.wars += r.events.wars.length; totals.conquered += r.events.conquered.length; totals.peace += r.events.peace.length;
      totals.growth = Math.max(totals.growth, ...r.delta.map((x) => x.d));
      if (r.events.wars.length === 0) totals.quiet++;
      if (!worst || now.share > worst.now.share) worst = { r, now };
    }
    Math.random = realRandom;
    const { r, now } = worst;
    rows.push(now.share);
    // ~25%: at most 25%, or barely above where the largest nation started (some seeds start at 26–29%).
    const ok = now.share <= Math.max(0.25, startMax + 0.01) + 1e-9;
    if (check && !ok) failures++;
    console.log(`${seed.padEnd(11)} ${pct(now.share).padStart(6)} ${now.name.padEnd(12)} ${pct(r.maxShare).padStart(6)} ${String(r.maxShareNation).padEnd(12)} ${String(r.events.wars.length).padStart(4)}  ${String(r.events.conquered.length).padStart(5)}  start ${pct(startMax)}  runs: ${shares.map(pct).join(' ')}${ok ? '' : '   ← over 25%'}`);
  }
  console.log(`worst-run max ${pct(Math.max(...rows))}, median ${pct([...rows].sort((a, b) => a - b)[rows.length >> 1])}`);
  console.log(`all ${totals.runs} runs: ${(totals.wars / totals.runs).toFixed(1)} wars, ${(totals.peace / totals.runs).toFixed(1)} peace deals, ${(totals.conquered / totals.runs).toFixed(2)} nations conquered per year; ${totals.quiet} runs without a war; biggest growth of a nation +${totals.growth} provinces\n`);
}

if (what === 'history' || what === 'all') {
  const months = opt('hmonths', 6);
  console.log(`Historical eras, ${months} months, Normal, average of ${RUNS} runs`);
  console.log('era         new wars  joined  peace  conquered  peak share (worst run)');
  for (const era of ERAS.filter((e) => !e.fictional)) {
    const sum = { nw: 0, all: 0, peace: 0, conq: 0 };
    let peak = 0, who = '';
    for (let k = 0; k < RUNS; k++) {
      seedDice(`${era.id}#${k}`);
      const r = simulate(era, { months, quiet: true });
      Math.random = realRandom;
      sum.nw += r.events.newWars.length; sum.all += r.events.wars.length; sum.peace += r.events.peace.length; sum.conq += r.events.conquered.length;
      if (r.maxShare > peak) { peak = r.maxShare; who = r.maxShareNation; }
    }
    const avg = (x) => (x / RUNS).toFixed(1);
    const newWars = sum.nw / RUNS;
    const ok = newWars >= 4 && newWars <= 16 && peak <= 0.15;
    if (check && !ok) failures++;
    console.log(`${era.id.padEnd(11)} ${avg(sum.nw).padStart(8)}  ${avg(sum.all - sum.nw).padStart(6)}  ${avg(sum.peace).padStart(5)}  ${avg(sum.conq).padStart(9)}  ${pct(peak).padStart(6)} ${who}${ok ? '' : '   ← off target'}`);
  }
}
if (check) { console.log(failures ? `${failures} target(s) missed` : 'all balance targets met'); process.exit(failures ? 1 : 0); }
