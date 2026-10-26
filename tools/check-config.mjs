// Sign-in settings are consistent: the owner list in js/config.js matches the
// one in docs/supabase-setup.sql (the database decides who is an owner), only
// the four supported providers are offered, and the key is a publishable one.
import { readFileSync } from 'node:fs';
import { OWNER_EMAILS, PROVIDERS, SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL } from '../js/config.js';

const problems = [];
const sql = readFileSync(new URL('../docs/supabase-setup.sql', import.meta.url), 'utf8');
const block = sql.match(/with wanted\(email\) as \(\s*values([\s\S]*?)\n\)/);
const inSql = block ? [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase()).sort() : [];
const inConfig = OWNER_EMAILS.map((e) => e.toLowerCase()).sort();
if (!block) problems.push('docs/supabase-setup.sql: owner list block not found');
else if (inSql.join() !== inConfig.join()) problems.push(`owner lists differ: config [${inConfig}] vs SQL [${inSql}]`);
if (!inConfig.length) problems.push('OWNER_EMAILS is empty');
const ids = PROVIDERS.map((p) => p.id).join();
if (ids !== 'google,discord,github,twitch') problems.push(`providers should be google, discord, github, twitch; got ${ids}`);
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL)) problems.push(`SUPABASE_URL looks wrong: ${SUPABASE_URL}`);
if (!SUPABASE_ANON_KEY.startsWith('sb_publishable_')) problems.push('SUPABASE_ANON_KEY must be the publishable key (sb_publishable_…)');
if (SITE_URL !== 'https://marquino24.github.io/iron-meridian/') problems.push(`SITE_URL: ${SITE_URL}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`config check: ${inConfig.length} owner(s) match the SQL, providers ${ids}, publishable key`);
