/**
 * projection.js — Miller cylindrical projection into world units.
 *
 * Shared by the build tool (tools/build-eras.mjs) and the runtime, so both
 * agree exactly on where a lat/lon lands. The world is clipped to
 * LAT_MIN..LAT_MAX (Antarctica and the far Arctic are cut off).
 */

export const WORLD_WIDTH = 4000;         // world units for 360° of longitude
export const LAT_MIN = -58;
export const LAT_MAX = 84;

const R = WORLD_WIDTH / (2 * Math.PI);
const D2R = Math.PI / 180;

const millerY = (lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * D2R));
const Y_TOP = millerY(LAT_MAX);
const Y_BOTTOM = millerY(LAT_MIN);

export const WORLD_HEIGHT = Math.round(R * (Y_TOP - Y_BOTTOM));

/** [lon, lat] in degrees → world {x, y} (y grows downward). */
export function project(lon, lat) {
  return { x: R * lon * D2R + WORLD_WIDTH / 2, y: R * (Y_TOP - millerY(lat)) };
}

/** World {x, y} → { lon, lat } in degrees. */
export function unproject(x, y) {
  const lon = ((x - WORLD_WIDTH / 2) / R) / D2R;
  const my = Y_TOP - y / R;
  const lat = (2.5 * Math.atan(Math.exp(0.8 * my)) - 0.625 * Math.PI) / D2R;
  return { lon, lat };
}

/** "48.9°N 2.4°E" */
export function formatLatLon(x, y) {
  const { lon, lat } = unproject(x, y);
  const f = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}

/** Projected latitude/longitude lines every `step` degrees, as polylines. */
export function graticule(step = 15) {
  const lines = [];
  for (let lon = -180; lon <= 180; lon += step) {
    lines.push([project(lon, LAT_MIN), project(lon, LAT_MAX)]);
  }
  for (let lat = Math.ceil(LAT_MIN / step) * step; lat <= LAT_MAX; lat += step) {
    lines.push([project(-180, lat), project(180, lat)]);
  }
  return lines;
}
