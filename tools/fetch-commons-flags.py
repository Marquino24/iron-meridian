#!/usr/bin/env python3
"""Download the Wikimedia Commons flag files named in tools/flag-sources.mjs.

For each file: the description page (for the canonical name, licence and
author) and the SVG itself, into a cache directory (default
.cache/flags/commons). Requests are spaced out and retried politely, because
Commons rate-limits bursts. Run before tools/build-flags.mjs:

    python3 tools/fetch-commons-flags.py [cache-dir]
"""
import hashlib, html, json, os, re, subprocess, sys, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cache', 'flags', 'commons')
UA = 'IronMeridianFlagBuild/1.0 (browser strategy game; https://github.com/marquino24)'
os.makedirs(CACHE, exist_ok=True)

titles = json.loads(subprocess.check_output(['node', '-e', '''
import("%s/tools/flag-sources.mjs").then(({ FLAG_SOURCES }) => {
  const t = new Set();
  for (const era of Object.values(FLAG_SOURCES)) for (const v of Object.values(era)) {
    const s = v.replace(/^col:/, '');
    if (s.startsWith('wc:')) t.add(s.slice(3));
  }
  console.log(JSON.stringify([...t]));
});''' % ROOT]))

def get(url, out=None):
    for attempt in range(8):
        args = ['curl', '-sSL', '-A', UA, '-w', '%{http_code}', '-o', out or '-', url]
        r = subprocess.run(args, capture_output=True)
        code = int(r.stdout[-3:]) if out else int(r.stdout[-3:])
        body = None if out else r.stdout[:-3].decode('utf8', 'replace')
        if code == 429 or code >= 500:
            time.sleep(10 * (attempt + 1))
            continue
        time.sleep(2)
        return code, body
    return 429, None

def key(title):
    return hashlib.sha1(title.encode()).hexdigest()[:16]

meta_path = os.path.join(CACHE, 'meta.json')
meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
missing = []
for t in titles:
    k = key(t)
    svg = os.path.join(CACHE, k + '.svg')
    have_svg = os.path.exists(svg) and os.path.getsize(svg) > 100 and '<svg' in open(svg, errors='replace').read(4000)
    if os.path.exists(svg) and not have_svg:
        os.remove(svg)  # an error page saved in place of the file
    m = meta.get(t, {})
    # Done unless the licence is missing, or a non-public-domain file lacks its author.
    if have_svg and m.get('licenses') and (m.get('author') or all('public domain' in l.lower() or l.startswith('PD') for l in m['licenses'])):
        continue
    page_url = 'https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(t.replace(' ', '_'))
    code, page = get(page_url)
    if code != 200 or 'noarticletext' in (page or '') or 'There is currently no text in this page' in (page or ''):
        missing.append(t); print('MISSING', t, code); continue
    canon = re.search(r'<link rel="canonical" href="https://commons.wikimedia.org/wiki/File:([^"]+)"', page)
    canon = urllib.parse.unquote(canon.group(1)).replace('_', ' ') if canon else t
    lic = sorted({html.unescape(x).strip() for x in re.findall(r'licensetpl&#95;short"[^>]*>([^<]*)<', page) if x.strip()})
    links = sorted({html.unescape(x).strip() for x in re.findall(r'licensetpl&#95;link"[^>]*>([^<]*)<', page) if x.strip()})
    author = re.search(r'id="fileinfotpl(?:_|&#95;)aut"[^>]*>.*?</td>\s*<td[^>]*>(.*?)</td>', page, re.S)
    author = re.sub(r'<[^>]+>', '', html.unescape(author.group(1))).strip()[:160] if author else ''
    file_url = re.search(r'href="((?:https:)?//upload\.wikimedia\.org/wikipedia/commons/[0-9a-f]/[0-9a-f]{2}/[^"?]+\.svg)(?:\?[^"]*)?"', page)
    if not file_url:
        missing.append(t); print('NOFILE', t); continue
    code = 200 if have_svg else get('https:' + html.unescape(file_url.group(1)).removeprefix('https:'), svg)[0]
    if code == 200 and '<svg' not in open(svg, errors='replace').read(4000):
        os.remove(svg); code = 'not-svg'
    if code != 200:
        missing.append(t); print('DOWNLOAD', code, t); continue
    meta[t] = {'file': k + '.svg', 'canonical': canon, 'licenses': lic, 'licenseLinks': links, 'author': author, 'page': 'https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(canon.replace(' ', '_'))}
    json.dump(meta, open(meta_path, 'w'), indent=1, ensure_ascii=False)
    print('ok', t, '|', ', '.join(lic), '|', author[:50])
print(len(meta), 'cached;', len(missing), 'missing')
for m in missing: print('  missing:', m)
