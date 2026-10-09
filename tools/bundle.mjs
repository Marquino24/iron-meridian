// Bundle the multi-file game into one self-contained HTML page (dist/iron-meridian.html).
//
// Each ES module is wrapped in an IIFE that returns its exports, and its
// `import { a, b } from './x.js'` lines become `const { a, b } = __x;`.
// Modules are emitted in dependency order, so names never collide across
// files. The source files stay the real project; this output is just for
// playing or hosting as a single file.
//
//   node tools/bundle.mjs            → full HTML document
//   node tools/bundle.mjs --fragment → no <html>/<head>/<body> wrapper (for hosts that add their own)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fragment = process.argv.includes('--fragment');
const read = (p) => readFileSync(join(root, p), 'utf8');

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w-]+)\.js['"];?\s*$/gm;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|class|const|let)\s+([\w$]+)/gm;

const modules = new Map(); // name → { deps, code, exports }
/** Module file name → valid JS identifier ('brand-icons' → '__brand_icons'). */
const ident = (name) => `__${name.replace(/[^\w$]/g, '_')}`;
function load(name) {
  if (modules.has(name)) return;
  let src = read(`js/${name}.js`);
  const deps = [];
  src = src.replace(IMPORT_RE, (_, names, dep) => {
    deps.push(dep);
    return `const {${names}} = ${ident(dep)};`;
  });
  const exports = [...src.matchAll(EXPORT_RE)].map((m) => m[1]);
  src = src.replace(/^export\s+/gm, '');
  modules.set(name, { deps, code: src, exports });
  deps.forEach(load);
}
load('main');

// Topological order: dependencies first.
const order = [];
const visit = (n) => {
  if (order.includes(n)) return;
  modules.get(n).deps.forEach(visit);
  order.push(n);
};
visit('main');

const js = order.map((n) => {
  const m = modules.get(n);
  return `// ---- js/${n}.js ----\nconst ${ident(n)} = (() => {\n${m.code}\nreturn { ${m.exports.join(', ')} };\n})();`;
}).join('\n\n');

// Pull <head> links and <body> markup out of index.html, inline the CSS and JS.
const html = read('index.html');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const headLinks = [...html.matchAll(/^\s*<link [^>]*>\s*$/gm)]
  .map((m) => m[0].trim())
  .filter((l) => !l.includes('styles.css'));
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/\s*<script type="module" src="js\/main\.js"><\/script>/, '')
  .trim();
const css = read('styles.css');
const safeJs = js.replace(/<\/script/gi, '<\\/script');

// Era data: one inert JSON block per era, parsed only when that era is chosen.
const eraDir = join(root, 'data/eras');
const eraTags = existsSync(eraDir)
  ? readdirSync(eraDir).filter((f) => f.endsWith('.json')).sort().map((f) =>
    `<script type="application/gzip-base64" id="era-data-${f.replace(/\.json$/, '')}">${gzipSync(readFileSync(join(eraDir, f)), { level: 9 }).toString('base64')}</script>`)
  : [];

const inner = [
  title,
  ...headLinks,
  `<style>\n${css}</style>`,
  body,
  ...eraTags,
  // The single-file build is the dev preview: no sign-in (it can't reach Supabase anyway).
  '<script>window.__IM_PREVIEW__ = true;</script>',
  `<script type="module">\n${safeJs}\n</script>`,
].join('\n');

const out = fragment
  ? inner + '\n'
  : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n${inner}\n</head>\n</html>\n`
      .replace(`${body}\n<script`, `</head>\n<body>\n${body}\n<script`)
      .replace(/<\/script>\n<\/head>\n<\/html>/, '</script>\n</body>\n</html>');

const file = join(root, 'dist', fragment ? 'iron-meridian.fragment.html' : 'iron-meridian.html');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, out);
console.log(`wrote ${file} (${(Buffer.byteLength(out) / 1024).toFixed(1)} KB; ${eraTags.length} eras; modules: ${order.join(' → ')})`);
