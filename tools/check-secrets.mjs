// Fails if a secret Supabase key (or other obvious secret) is committed to a
// file that ships to the browser. Only the publishable/anon key may appear.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = ['index.html', ...fs.readdirSync(path.join(root, 'js')).map((f) => `js/${f}`)];
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
  if (/client_secret|GOCSPX-/i.test(text) && f !== 'js/auth.js') problems.push(`${f}: looks like it contains an OAuth client secret`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`secrets check: ${files.length} browser files clean`);
