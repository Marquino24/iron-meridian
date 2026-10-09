/**
 * eras.js — The selectable scenarios on the start screen.
 *
 * Real-world eras load their prebuilt data (data/eras/<id>.json, built by
 * tools/build-eras.mjs). "fictional" uses the procedural generator in map.js.
 * `start` is the in-game date the clock starts at.
 */

export const ERAS = [
  { id: 'rome', label: 'Roman Empire', year: 'AD 117', start: Date.UTC(117, 7, 8, 6), dataNote: 'borders of AD 100' },
  { id: 'medieval', label: 'Medieval', year: '1200', start: Date.UTC(1200, 0, 1, 6) },
  { id: 'ww1', label: 'World War I', year: '1914', start: Date.UTC(1914, 6, 28, 6) },
  { id: 'ww2', label: 'World War II', year: '1939', start: Date.UTC(1939, 8, 1, 4, 45), dataNote: 'borders of 1938' },
  { id: 'coldwar', label: 'Cold War', year: '1960', start: Date.UTC(1960, 4, 1, 6) },
  { id: 'modern', label: 'Modern', year: 'Present', start: null },
  { id: 'fictional', label: 'Fictional World', year: 'Procedural', start: null, fictional: true },
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
  if (embedded) return JSON.parse(embedded.textContent);
  const res = await fetch(`data/eras/${id}.json`);
  if (!res.ok) throw new Error(`Could not load era "${id}" (HTTP ${res.status})`);
  return res.json();
}
