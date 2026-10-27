// Copies the game simulation (js/), the WWII and Modern maps and the spike's
// test states into supabase/functions/tick-spike/game/, so the spike can be
// deployed as a Supabase Edge Function and measured on Supabase's own hardware:
//   node tools/spike/server-tick.mjs prepare ww2 90 && node tools/spike/server-tick.mjs prepare modern 120 --busy
//   node tools/spike/build-edge.mjs
//   supabase functions deploy tick-spike          (needs the Supabase CLI, logged in)
// The copy is generated (gitignored); only index.ts is kept in the repo.
import { cpSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const out = new URL('supabase/functions/tick-spike/game/', root);
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('js/', out), { recursive: true });
mkdirSync(new URL('data/', out), { recursive: true });
for (const f of readdirSync(new URL('js/', root))) if (f.endsWith('.js')) cpSync(new URL(`js/${f}`, root), new URL(`js/${f}`, out));
for (const e of ['ww2', 'modern']) cpSync(new URL(`data/eras/${e}.json`, root), new URL(`data/${e}.json`, out));
for (const f of readdirSync(new URL('tools/spike/', root))) if (f.startsWith('.state-')) cpSync(new URL(`tools/spike/${f}`, root), new URL(`data/${f.slice(1)}`, out));
console.log(`copied the game into ${out.pathname}${existsSync(new URL('data/state-ww2.bin', out)) ? '' : ' (no test states: run server-tick.mjs prepare first)'}`);
