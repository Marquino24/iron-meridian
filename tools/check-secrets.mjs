// Fails if a secret Supabase key (or other obvious secret) is committed to a
// file that ships to the browser. Only the publishable/anon key may appear.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// Every committed text file (the whole repository is published on GitHub Pages).
import { execFileSync } from 'node:child_process';
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n')
  .filter((f) => /\.(html|js|mjs|css|json|md|sql|sh|txt|py|yml|yaml)$/.test(f) && !f.startsWith('vendor/') && !f.startsWith('data/eras/') && f !== 'tools/check-secrets.mjs');
const problems = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  if (/sb_secret_[A-Za-z0-9_-]+/.test(text)) problems.push(`${f}: contains a Supabase SECRET key (sb_secret_…)`);
  for (const jwt of text.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      if (payload.role && payload.role !== 'anon') problems.push(`${f}: contains a "${payload.role}" key; only the anon/publishable key is allowed`);
    } catch { /* not a JWT */ }
  }
  if (/GOCSPX-|client_secret\s*[:=]\s*['"][^'"]{8,}/i.test(text)) problems.push(`${f}: looks like it contains an OAuth client secret`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`secrets check: ${files.length} committed files clean`);
