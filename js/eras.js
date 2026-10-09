/**
 * eras.js — The selectable scenarios on the start screen.
 *
 * Real-world eras load their prebuilt data (data/eras/<id>.json, built by
 * tools/build-eras.mjs). "fictional" uses the procedural generator in map.js.
 * `start` is the in-game date the clock starts at.
 */

export const ERAS = [
  { id: 'rome', label: 'Roman Empire', year: 'AD 117', start: Date.UTC(117, 7, 8, 6), oldMap: true, blurb: 'Rome at its greatest extent, facing Parthia; Han China in the east.' },
  { id: 'medieval', label: 'Medieval', year: '1200', start: Date.UTC(1200, 0, 1, 6), oldMap: true, blurb: 'Crusader kingdoms, the Holy Roman Empire and a rising Mongol Empire.' },
  { id: 'ww1', label: 'World War I', year: '1914', start: Date.UTC(1914, 6, 28, 6), blurb: 'The great empires on the eve of war, colonies and all.' },
  { id: 'ww2', label: 'World War II', year: '1939', start: Date.UTC(1939, 8, 1, 4, 45), blurb: 'September 1939: the Axis and the Allies, from Europe to the Pacific.' },
  { id: 'coldwar', label: 'Cold War', year: '1960', start: Date.UTC(1960, 4, 1, 6), blurb: 'Two superpowers, a divided Germany and a wave of new nations.' },
  { id: 'modern', label: 'Modern', year: 'Present', start: null, blurb: 'Today\'s 200 nations, divided into their real states and regions.' },
  { id: 'fictional', label: 'Fictional World', year: 'Procedural', start: null, fictional: true, blurb: 'A generated continent with six nations. Every seed is a new map.' },
];

export const DEFAULT_ERA = 'ww2';

export const getEra = (id) => ERAS.find((e) => e.id === id) ?? ERAS.find((e) => e.id === DEFAULT_ERA);

/**
 * Fetch an era's data. The single-file build embeds each era as
 * <script type="application/json" id="era-data-<id>">, parsed only when chosen;
 * the multi-file project fetches data/eras/<id>.json.
 */
export async function loadEraData(id) {
  const embedded = document.getElementById(`era-data-${id}`);
  if (embedded?.type === 'application/gzip-base64') return JSON.parse(await gunzipBase64(embedded.textContent));
  if (embedded) return JSON.parse(embedded.textContent);
  const res = await fetch(`data/eras/${id}.json`);
  if (!res.ok) throw new Error(`Could not load era "${id}" (HTTP ${res.status})`);
  return res.json();
}

/** The single-file build stores era data gzip-compressed (base64) to stay small. */
async function gunzipBase64(b64) {
  const bytes = Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
