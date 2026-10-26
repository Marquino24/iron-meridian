/**
 * flag-custom.mjs — Banners drawn here as SVG (3:2, 300×200), for eras before
 * national flags: the Roman vexillum, a Han banner, and medieval banners of
 * arms simple enough to draw faithfully (lions and eagles come from Commons),
 * and the colonial flags of a few major colonies (step 7B).
 * Original work for this game, same licence as the game.
 */

/** Union Flag on a 60×30 grid (the canton of the British ensigns). */
const UNION = `<clipPath id="u-s"><path d="M0 0v30h60V0z"/></clipPath><clipPath id="u-t"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath>
  <g clip-path="url(#u-s)"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/>
  <path d="M0 0l60 30m0-30L0 30" clip-path="url(#u-t)" stroke="#c8102e" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/>
  <path d="M30 0v30M0 15h60" stroke="#c8102e" stroke-width="6"/></g>`;

/** Five-pointed star path, centred on (cx, cy), outer radius r. */
const star = (cx, cy, r, inner = 0.382) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * inner : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
};

/** The Star of India badge: gold rays, a sky-blue garter (its motto left out at this size), a silver star. */
const starOfIndia = (cx, cy, r) => {
  let rays = '';
  for (let i = 0; i < 24; i++) {
    const a = (i * Math.PI) / 12, w = Math.PI / 40;
    const p = (ang, rr) => `${(cx + rr * Math.cos(ang)).toFixed(2)} ${(cy + rr * Math.sin(ang)).toFixed(2)}`;
    rays += `M${p(a - w, r * 0.62)}L${p(a, r * (i % 2 ? 0.88 : 1))}L${p(a + w, r * 0.62)}Z`;
  }
  return `<path d="${rays}" fill="#f2c230" stroke="#b07d10" stroke-width="0.3"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.6}" fill="#7cc0ea" stroke="#f2c230" stroke-width="0.8"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="#fff" stroke="#f2c230" stroke-width="0.6"/>
    <path d="${star(cx, cy, r * 0.36)}" fill="#e9eef2" stroke="#7d8a96" stroke-width="0.4"/>`;
};

/** Heraldic fleur-de-lis, centred on (0,0), about 40 units tall. */
const FLEUR = 'M0-20c-4 5-6 10-5 15 1 4 4 7 5 9 1-2 4-5 5-9 1-5-1-10-5-15zM-3 4c-6-1-12-6-14-12-1-4 1-7 5-7 3 0 5 3 4 6-1-1-3-2-4-1-2 1-1 4 1 6 2 3 5 5 8 6zM3 4c6-1 12-6 14-12 1-4-1-7-5-7-3 0-5 3-4 6 1-1 3-2 4-1 2 1 1 4-1 6-2 3-5 5-8 6zM-8 5h16v3h-16zM-2 8h4l2 10c-2 1-6 1-8 0z';

const fleurs = () => {
  // France ancien: azure semé de lis or (staggered rows).
  let out = '';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) {
    const x = 25 + c * 50 + (r % 2 ? 25 : 0), y = 22 + r * 40;
    if (x > 310) continue;
    out += `<path transform="translate(${x} ${y}) scale(0.82)" d="${FLEUR}" fill="#f4c430" stroke="#a87b10" stroke-width="0.8"/>`;
  }
  return out;
};

/** Gold triple-towered castle (Castile), centred. */
const CASTLE = `<g fill="#f4c430" stroke="#6b4a08" stroke-width="2">
  <path d="M95 165h110v-55h-110z"/>
  <path d="M105 110v-30h20v30zM140 110v-45h20v45zM175 110v-30h20v30z"/>
  <path d="M100 80h30v-10h-6v6h-6v-6h-6v6h-6v-6h-6zM135 65h30v-10h-6v6h-6v-6h-6v6h-6v-6h-6zM170 80h30v-10h-6v6h-6v-6h-6v6h-6v-6h-6z"/>
  <path d="M90 170h120v-8h-120z"/>
</g>
<path d="M141 165v-28a9 9 0 0 1 18 0v28z" fill="#2a4fa0"/>
<path d="M112 100h6v-10h-6zM147 90h6v-12h-6zM182 100h6v-10h-6zM110 135h8v-12h-8zM182 135h8v-12h-8z" fill="#2a4fa0"/>`;

export const CUSTOM_FLAGS = {
  // British India (Star of India ensign): the Red Ensign defaced with the Star of India.
  'star-of-india': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60" fill="#c8102e"/>${UNION}${starOfIndia(90, 30, 19)}</svg>`,
  // Belgian Congo (1908–1960, as the Congo Free State before it): blue with a gold star.
  'belgian-congo': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#1c4fa3"/><path d="${star(150, 104, 58)}" fill="#f7d117"/></svg>`,
  // French Indochina (1923–1945): yellow with the French tricolour in the canton.
  'french-indochina': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f7d117"/><rect width="50" height="100" fill="#0055a4"/><rect x="50" width="50" height="100" fill="#fff"/><rect x="100" width="50" height="100" fill="#ef4135"/></svg>`,
  // Mali Federation (1959–60, Senegal and French Sudan): green-yellow-red with a black kanaga figure.
  'mali-federation': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
    <rect width="100" height="200" fill="#14b53a"/><rect x="100" width="100" height="200" fill="#fcd116"/><rect x="200" width="100" height="200" fill="#ce1126"/>
    <g fill="#000"><rect x="146" y="40" width="8" height="120"/><rect x="115" y="70" width="70" height="8"/><rect x="115" y="122" width="70" height="8"/>
      <rect x="115" y="48" width="8" height="30"/><rect x="177" y="48" width="8" height="30"/><rect x="115" y="122" width="8" height="30"/><rect x="177" y="122" width="8" height="30"/>
      <circle cx="150" cy="36" r="9"/></g></svg>`,
  // Roman vexillum: red cloth on a crossbar, gold fringe, SPQR in gold.
  spqr: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
    <rect width="300" height="200" fill="#1b0d0a"/>
    <rect x="18" y="16" width="264" height="10" rx="5" fill="#c9952c"/>
    <path d="M30 26h240v138h-240z" fill="#a3121c"/>
    <path d="M30 26h240v138h-240z" fill="none" stroke="#e8b84a" stroke-width="5"/>
    <path d="M30 164h240" stroke="#e8b84a" stroke-width="3"/>
    ${Array.from({ length: 24 }, (_, i) => `<path d="M${34 + i * 10} 166v20" stroke="#e8b84a" stroke-width="4" stroke-linecap="round"/>`).join('')}
    <path d="M150 44l9 9 15-6-8 12 14 4-15 5 5 12-14-6-6 10-6-10-14 6 5-12-15-5 14-4-8-12 15 6z" fill="#f2c94c"/>
    <text x="150" y="140" text-anchor="middle" font-family="DejaVu Serif, Georgia, serif" font-weight="bold" font-size="58" letter-spacing="4" fill="#f2c94c" stroke="#7a4a08" stroke-width="1.2">SPQR</text>
  </svg>`,
  // Han dynasty banner: red field, black border, 漢 in a gold disc.
  han: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
    <rect width="300" height="200" fill="#b3171d"/>
    <rect x="8" y="8" width="284" height="184" fill="none" stroke="#1a1414" stroke-width="12"/>
    ${Array.from({ length: 7 }, (_, i) => `<path d="M${14 + i * 45} 186l12 14 12-14z" fill="#1a1414"/>`).join('')}
    <circle cx="150" cy="100" r="62" fill="#f2c94c" stroke="#1a1414" stroke-width="5"/>
    <text x="150" y="134" text-anchor="middle" font-family="WenQuanYi Zen Hei, Noto Sans CJK SC, sans-serif" font-size="96" font-weight="bold" fill="#1a1414">漢</text>
  </svg>`,
  'france-ancien': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#1f3f9e"/>${fleurs()}</svg>`,
  castile: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#c4161c"/>${CASTLE}</svg>`,
  // Aragon: or, four pallets gules.
  aragon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f4c430"/>${[1, 3, 5, 7].map((i) => `<rect x="0" y="${(i * 200) / 9}" width="300" height="${200 / 9}" fill="#d01c1f"/>`).join('')}</svg>`,
  // Árpád stripes: barry of eight gules and argent.
  arpad: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">${Array.from({ length: 8 }, (_, i) => `<rect y="${i * 25}" width="300" height="25" fill="${i % 2 ? '#ffffff' : '#c8102e'}"/>`).join('')}</svg>`,
  // Burgundy ancien: bendy of six or and azure, a bordure gules.
  'burgundy-ancien': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><defs><clipPath id="c"><rect width="300" height="200"/></clipPath></defs><g clip-path="url(#c)"><rect width="300" height="200" fill="#f4c430"/><g transform="rotate(33.7 150 100)">${Array.from({ length: 4 }, (_, i) => `<rect x="-200" y="${-130 + i * 120}" width="700" height="60" fill="#1f3f9e"/>`).join('')}</g></g><rect x="9" y="9" width="282" height="182" fill="none" stroke="#c8102e" stroke-width="18"/></svg>`,
};
