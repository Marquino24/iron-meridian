// Copies the game simulation (js/) and the era maps into the tick Edge
// Function (supabase/functions/tick/game/, gitignored), ready to deploy:
//   node tools/build-functions.mjs && supabase functions deploy tick --no-verify-jwt
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const out = new URL('supabase/functions/tick/game/', root);
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('js/', out), { recursive: true });
mkdirSync(new URL('data/', out), { recursive: true });
let files = 0;
for (const f of readdirSync(new URL('js/', root))) if (f.endsWith('.js')) { cpSync(new URL(`js/${f}`, root), new URL(`js/${f}`, out)); files++; }
for (const f of readdirSync(new URL('data/eras/', root))) if (f.endsWith('.json')) { cpSync(new URL(`data/eras/${f}`, root), new URL(`data/${f}`, out)); files++; }
console.log(`copied ${files} files into ${out.pathname}`);
