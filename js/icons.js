/**
 * icons.js — Every icon in the game, drawn as SVG paths in code (no image
 * files). One definition serves both the HUD (inline <svg>) and the map
 * canvas (Path2D, cached).
 *
 * An icon is a list of layers [pathData, fill] on a 24×24 grid. A fill of
 * 'currentColor' takes the colour the caller asks for (white on map markers,
 * the text colour in the HUD); other fills are fixed (gold coins, red barrels).
 */

const CC = 'currentColor';
const SHADE = 'rgba(0,0,0,0.32)';

export const ICONS = {
  // --- Resources ------------------------------------------------------------
  money: [
    ['M12 1.5A10.5 10.5 0 1 1 11.99 1.5Z', '#c98a12'],
    ['M12 3A9 9 0 1 1 11.99 3Z', '#f5bd2f'],
    ['M12 5.5A6.5 6.5 0 1 1 11.99 5.5Z', '#ffd864'],
    ['M11 7.5h2v1.2c1.2.2 2.1.9 2.3 2h-1.9c-.2-.4-.6-.6-1.3-.6-.8 0-1.2.3-1.2.7 0 .5.5.6 1.6.9 1.6.4 2.9.9 2.9 2.5 0 1.2-.9 2-2.4 2.3v1.2h-2v-1.2c-1.4-.2-2.4-1-2.5-2.3h1.9c.1.5.6.8 1.5.8.8 0 1.3-.3 1.3-.8s-.5-.6-1.7-.9c-1.5-.4-2.8-.9-2.8-2.4 0-1.1.9-1.9 2.3-2.2z', '#b0700a'],
  ],
  food: [
    ['M11.2 22V8.5h1.6V22z', '#b9852b'],
    ['M12 2.2c1.7 1.3 1.7 3.6 0 4.9-1.7-1.3-1.7-3.6 0-4.9z', '#f4cc52'],
    ['M10.9 8.4c-2 .1-3.5 1.7-3.5 3.6 2-.1 3.5-1.7 3.5-3.6zM13.1 8.4c2 .1 3.5 1.7 3.5 3.6-2-.1-3.5-1.7-3.5-3.6z', '#f4cc52'],
    ['M10.9 12.6c-2 .1-3.5 1.7-3.5 3.6 2-.1 3.5-1.7 3.5-3.6zM13.1 12.6c2 .1 3.5 1.7 3.5 3.6-2-.1-3.5-1.7-3.5-3.6z', '#e3b23c'],
  ],
  steel: [
    ['M3 10h18l-2 9H5z', '#7f8e9c'],
    ['M5.5 10l3-4.5h7l3 4.5z', '#dfe7ef'],
    ['M6.5 12h11l-.4 1.6H6.9z', 'rgba(255,255,255,0.45)'],
  ],
  oil: [
    ['M6 3.5h12a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z', '#c0392b'],
    ['M5 7.5h14v1.8H5zM5 14.7h14v1.8H5z', '#7b1d14'],
    ['M12 9.8c1.3 1.8 2.2 3 2.2 4.1a2.2 2.2 0 0 1-4.4 0c0-1.1.9-2.3 2.2-4.1z', '#1d1a22'],
    ['M7.2 4.6h2.6v1H7.2z', 'rgba(255,220,210,0.7)'],
  ],
  electronics: [
    ['M9 3h1.5v3H9zM13.5 3H15v3h-1.5zM9 18h1.5v3H9zM13.5 18H15v3h-1.5zM3 9h3v1.5H3zM3 13.5h3V15H3zM18 9h3v1.5h-3zM18 13.5h3V15h-3z', '#a9eef7'],
    ['M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z', '#22a6bb'],
    ['M9.5 9.5h5v5h-5z', '#0b3a44'],
  ],
  manpower: [
    ['M12 3a3.6 3.6 0 1 1-.01 0z', '#f0d0a6'],
    ['M4.5 21c0-4.4 3.4-7.6 7.5-7.6s7.5 3.2 7.5 7.6z', '#5f8fd6'],
    ['M8.2 5.6c.6-1.8 2.1-2.9 3.8-2.9s3.2 1.1 3.8 2.9c-1.2-.4-2.5-.6-3.8-.6s-2.6.2-3.8.6z', '#3f6a3a'],
  ],

  // --- Units (white silhouettes on markers) ----------------------------------
  scutum: [
    ['M7 2.5h10a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z', CC],
    ['M11.2 3.5h1.6v17h-1.6z', SHADE],
    ['M12 9.2a2.8 2.8 0 1 1-.01 0z', SHADE],
  ],
  kite: [
    ['M12 2.5l7.5 3v5.5c0 5.2-3.2 8.8-7.5 10.5-4.3-1.7-7.5-5.3-7.5-10.5V5.5z', CC],
    ['M11.1 5h1.8v13h-1.8zM7.5 9.2h9v1.8h-9z', SHADE],
  ],
  bow: [
    ['M6 2.5c6.5 3.2 6.5 15.8 0 19l-1.1-1.6c4.8-2.8 4.8-12.9 0-15.8z', CC],
    ['M5.6 3.7l.9-.2v17l-.9-.2z', CC],
    ['M8 11.2h10.4l-2-2 1.1-1.1 3.9 3.9-3.9 3.9-1.1-1.1 2-2H8z', CC],
  ],
  horse: [
    ['M7 21.5l.6-6.3c-1.4-1.2-2.4-3.4-1.6-5.6l2.6-4.4L9 2.5l2.4 2.1 4.1.9c2.1.6 3.4 2.2 3.4 3.9l-1.6 1.2-2.6-.9-1 1 1.1 3.8.4 7z', CC],
    ['M12.6 7.6a.9.9 0 1 1-.01 0z', SHADE],
  ],
  greathelm: [
    ['M5.5 9.5a6.5 6.5 0 0 1 13 0V19a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 19z', CC],
    ['M7.5 11h9v1.6h-9zM11.2 13.5h1.6v5h-1.6z', SHADE],
    ['M11 1.5h2v3h-2z', CC],
  ],
  galley: [
    ['M1.5 14h21l-3.2 6H4.7z', CC],
    ['M11.2 3.5h1.6V14h-1.6z', CC],
    ['M13.2 4.5c3.2 1.4 5 4.2 5.3 8h-5.3z', CC],
    ['M5 15.5h1.2v4H5zM8.2 15.5h1.2v4H8.2zM11.4 15.5h1.2v4h-1.2zM14.6 15.5h1.2v4h-1.2z', SHADE],
  ],
  cog: [
    ['M2 14h20l-2.6 6.5H4.6z', CC],
    ['M11.2 2.5h1.6V14h-1.6z', CC],
    ['M5.5 4h13l-1.2 8H6.7z', CC],
    ['M6 7.5h12v1.2H6z', SHADE],
  ],
  brodie: [
    ['M1.5 14.5c0-1 1-1.5 2-1.5h1.3C5.4 8.4 8.4 5 12 5s6.6 3.4 7.2 8h1.3c1 0 2 .5 2 1.5S21.5 16 20.5 16h-17c-1 0-2-.5-2-1.5z', CC],
    ['M9 17.5h6v3H9z', CC],
  ],
  stahlhelm: [
    ['M3.5 15.5c0-5.6 3.8-9.5 8.5-9.5s8 3.2 8 7.6l2 1.1v2.1l-3.2.5c-1 .3-2.2.5-3.2.5H7c-2 0-3.5-.9-3.5-2.3z', CC],
    ['M6 14.2h13.5v1.2H6z', SHADE],
  ],
  combat: [
    ['M5.5 10.2C5.5 6 8.4 3 12 3s6.5 3 6.5 7.2v1.3h-13z', CC],
    ['M8.2 12.6h7.6v1.6c0 2.3-1.7 4-3.8 4s-3.8-1.7-3.8-4z', CC],
    ['M3 22c.4-2.7 2.8-4.3 5.6-4.6L12 19.6l3.4-2.2c2.8.3 5.2 1.9 5.6 4.6z', CC],
    ['M7.3 8.6h9.4v2H7.3z', SHADE],
  ],
  fieldgun: [
    ['M2.5 13.2l13.2-6.1 1.2 2.5L3.7 15.7z', CC],
    ['M14.5 11.5a4.6 4.6 0 1 1-.01 0z', CC],
    ['M14.5 14.4a1.7 1.7 0 1 1-.01 0z', SHADE],
    ['M15.6 17.4l6.2 3.6-.9 1.5-6.2-3.6z', CC],
  ],
  tank: [
    ['M2.5 14.5h19l-2.2 5.5H4.7z', CC],
    ['M7 9.5h8l2 5H5z', CC],
    ['M15.5 10.4h7v1.6h-7z', CC],
    ['M5.5 16.2a1.4 1.4 0 1 1-.01 0zM9.3 16.2a1.4 1.4 0 1 1-.01 0zM13.1 16.2a1.4 1.4 0 1 1-.01 0zM16.9 16.2a1.4 1.4 0 1 1-.01 0z', SHADE],
  ],
  mbt: [
    ['M1.5 14.8h21l-2.4 5.2H3.9z', CC],
    ['M6 10.5l2-2h7.5l3 3.3v3H5.5z', CC],
    ['M17.5 10.2h6v1.3h-6z', CC],
    ['M3.5 17.2h17v1.2h-17z', SHADE],
  ],
  apc: [
    ['M2.5 11.5l3.5-3.5h11.5l4.5 3.5v6H2.5z', CC],
    ['M6.5 17.5a2 2 0 1 1-.01 0zM12 17.5a2 2 0 1 1-.01 0zM17.5 17.5a2 2 0 1 1-.01 0z', CC],
    ['M8 10h3v2.2H8zM12.5 10h3v2.2h-3z', SHADE],
  ],
  howitzer: [
    ['M2.5 14.5h17l-2 5H4.5z', CC],
    ['M6 10.5h9l2 4H5z', CC],
    ['M13.5 10.8l8-5.8 1 1.4-8 5.8z', CC],
    ['M5.5 16.5h13v1.2h-13z', SHADE],
  ],
  rocket: [
    ['M1.5 15h13v3.5h-13zM14.5 12h4.2l3.3 3.2v3.3h-7.5z', CC],
    ['M3.5 13.8l8.6-6.6 1.6 2.1-8.6 6.6z', CC],
    ['M4.5 19.5a1.6 1.6 0 1 1-.01 0zM10 19.5a1.6 1.6 0 1 1-.01 0zM18 19.5a1.6 1.6 0 1 1-.01 0z', CC],
    ['M15.8 13.2h2.4l1.6 1.6h-4z', SHADE],
  ],
  drone: [
    ['M10 10h4v4h-4z', CC],
    ['M4.5 4.5l15 15-1 1-15-15zM19.5 4.5l1 1-15 15-1-1z', CC],
    ['M5 2a3 3 0 1 1-.01 0zM19 2a3 3 0 1 1-.01 0zM5 16a3 3 0 1 1-.01 0zM19 16a3 3 0 1 1-.01 0z', CC],
  ],
  warship: [
    ['M1 15h22l-3.2 5.5H4.2z', CC],
    ['M6 11h8.5v4H6zM8.5 7.5h3.5V11H8.5z', CC],
    ['M15 12.4h6.5v1.3H15zM9.8 3.5h1v4h-1z', CC],
    ['M3.5 16.5h17v1.2h-17z', SHADE],
  ],

  // --- Buildings ----------------------------------------------------------------
  farm: [
    ['M3 11.5L12 4l9 7.5V21H3z', '#c84a38'],
    ['M12 4l9 7.5-1.2 1.4L12 6.5l-7.8 6.4L3 11.5z', '#f2efe6'],
    ['M9.5 14h5v7h-5z', '#7a2418'],
    ['M9.5 14h1.2l1.3 2.2 1.3-2.2h1.2v.9L12.7 17.5l1.8 2.6v.9h-1.2L12 18.8 10.7 21H9.5v-.9l1.8-2.6-1.8-2.6z', '#f2efe6'],
  ],
  factory: [
    ['M2 21V10.5l5 3v-3l5 3v-3l5 3V3.5h4V21z', '#8b97a4'],
    ['M5 15.5h2.5V18H5zM10 15.5h2.5V18H10z', '#ffd864'],
    ['M17.5 1.5c1.8-.4 3.4.4 3.9 1.7-1 .2-2.3-.1-3.9-.6z', '#c9d1d8'],
  ],
  mine: [
    ['M3.8 6.2c4.4-3.3 12-3.3 16.4 0l-1 1.5c-1.5-1-3.4-1.6-5.2-1.8L7.6 20.7 5.4 19.4l6.3-13.6c-2.1.2-4.4.9-6.6 2z', '#a7b2bc'],
    ['M5.4 19.4l2.2 1.3-1 1.8-2.2-1.3z', '#7a4e24'],
  ],
  oilwell: [
    ['M8 21.5l3-18h2l3 18h-2l-.5-3h-3l-.5 3zM10.9 15h2.2l-.6-3.5h-1z', '#5b5f6a'],
    ['M18.5 13c1.1 1.5 1.8 2.5 1.8 3.4a1.8 1.8 0 0 1-3.6 0c0-.9.7-1.9 1.8-3.4z', '#1d1a22'],
    ['M10 6.5h4v1.3h-4z', '#c0392b'],
  ],
  barracks: [
    ['M2.5 20.5L12 6l9.5 14.5z', '#7a8a4a'],
    ['M12 6l9.5 14.5h-3L12 10.5z', '#5e6d36'],
    ['M10.5 20.5L12 15l1.5 5.5z', '#2b3118'],
    ['M11.5 1.5h1v5h-1z', '#3b2a18'],
    ['M12.5 1.5h6l-1.6 1.6 1.6 1.6h-6z', '#d63c2f'],
  ],
  port: [
    ['M11 2.5h2v3h3v2h-3v11.4c2.6-.4 4.6-2.4 5-4.9h-2l3-3 3 3h-2c-.5 4.5-4.3 8-9 8s-8.5-3.5-9-8H0l3-3 3 3H4c.4 2.5 2.4 4.5 5 4.9V7.5H6v-2h3v-3z', '#3d7fd0'],
  ],
  fort: [
    ['M3 21V8.5h3v3h2.2v-3h3.6v3H14v-3h3.6v3H20v-3h1V21h-7.5v-5h-3v5z', '#a3a8ad'],
    ['M10.5 16h3v5h-3z', '#4a3b2c'],
    ['M3 8.5h18v1.4H3z', 'rgba(255,255,255,0.35)'],
  ],
  roads: [
    ['M9 2.5h2.2l-1.1 19H3.5zM12.8 2.5H15l5.5 19h-6.6z', '#7b6f62'],
    ['M11.3 4.5h1.4v3h-1.4zM11.1 10h1.8v4h-1.8zM10.9 16.5h2.2v5h-2.2z', '#ffd864'],
  ],

  // --- HUD and map -----------------------------------------------------------------
  trophy: [
    ['M7 3h10v6a5 5 0 0 1-10 0z', '#f5c02f'],
    ['M7 4.5H3.5v1.8a4 4 0 0 0 3.8 4l.2-1.9a2.2 2.2 0 0 1-2.2-2.1V6.3H7zM17 4.5h3.5v1.8a4 4 0 0 1-3.8 4l-.2-1.9a2.2 2.2 0 0 0 2.2-2.1V6.3H17z', '#d99a12'],
    ['M10.8 13.8h2.4v3.4h-2.4z', '#d99a12'],
    ['M7.5 17.2h9v3.6h-9z', '#8a5a1a'],
    ['M9 4.5h1.6v5.4H9z', 'rgba(255,255,255,0.45)'],
  ],
  diplomacy: [
    ['M5 4h12.5a2.5 2.5 0 0 1 2.5 2.5V19a2 2 0 0 1-2 2H7.5A2.5 2.5 0 0 1 5 18.5z', '#f0dcae'],
    ['M5 4a2 2 0 0 0-2 2v1.5h4V6a2 2 0 0 0-2-2zM7.5 21a2.5 2.5 0 0 0 2.5-2.5V17H5v1.5A2.5 2.5 0 0 0 7.5 21z', '#cfae6c'],
    ['M9 8h8v1.4H9zM9 11h8v1.4H9zM9 14h5v1.4H9z', '#8a6a3a'],
    ['M16 15.5a3 3 0 1 1-.01 0z', '#c62a2a'],
    ['M15 20.5l1-2.5 1 2.5 1-1-1-2.6h-2l-1 2.6z', '#c62a2a'],
  ],
  brush: [

    ['M20.7 2.3a1 1 0 0 1 0 1.4L11.4 13 10 11.6l9.3-9.3a1 1 0 0 1 1.4 0z', '#c8894a'],
    ['M8.6 12.8c1.5 0 2.7 1.2 2.7 2.7 0 3.1-2.5 5.5-5.6 5.5H2.3c1.3-1 1.7-2.2 1.8-3.6.2-2.6 2-4.6 4.5-4.6z', '#ff5a8a'],
  ],
  bolt: [['M13.8 1.5L4 13.8h6.6L9 22.5l10.2-13.2h-6.6z', '#ffd23f'], ['M13.8 1.5L9.6 10h3l1.2-8.5z', 'rgba(255,255,255,0.5)']],
  pick: [['M11 1.5h2v5h-2zM11 17.5h2v5h-2zM1.5 11h5v2h-5zM17.5 11h5v2h-5z', CC], ['M12 6.5a5.5 5.5 0 1 1-.01 0zM12 9a3 3 0 1 0 .01 0z', CC]],
  robot: [
    ['M11 1.5h2v3h-2z', CC],
    ['M6 5h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', CC],
    ['M8.5 9a1.6 1.6 0 1 1-.01 0zM15.5 9a1.6 1.6 0 1 1-.01 0zM8.5 13.5h7v1.5h-7z', SHADE],
    ['M7 18h3v4H7zM14 18h3v4h-3zM1.5 9h2v5h-2zM20.5 9h2v5h-2z', CC],
  ],
  army: [['M5 2.5h1.8v19H5z', '#6b4b2a'], ['M6.8 3h12.7l-3 4 3 4H6.8z', '#d63c2f']],
  production: [
    ['M12 2l1.6 2.6 3-.6.6 3 2.6 1.6-1.5 2.4 1.5 2.4-2.6 1.6-.6 3-3-.6L12 20l-1.6-2.6-3 .6-.6-3-2.6-1.6 1.5-2.4L4.2 9.6l2.6-1.6.6-3 3 .6z', '#f39c26'],
    ['M12 7.8a3.2 3.2 0 1 1-.01 0z', '#5a3105'],
  ],
  buildings: [
    ['M3 21V8.5h3v3h2.2v-3h3.6v3H14v-3h3.6v3H20v-3h1V21z', '#46b46a'],
    ['M10.5 16h3v5h-3z', '#1d5a31'],
  ],
  research: [
    ['M9 2.5h6v1.8h-1v4.8l5.7 9.6c.8 1.4-.2 3.3-1.9 3.3H6.2c-1.7 0-2.7-1.9-1.9-3.3L10 9.1V4.3H9z', '#4ba3ff'],
    ['M7.6 15h8.8l2.3 3.8c.4.6-.1 1.4-.8 1.4H6.1c-.7 0-1.2-.8-.8-1.4z', '#bff6ff'],
  ],
  castle: [
    ['M4 21V9h2.5v2.5h2V9H11v2.5h2V9h2.5v2.5h2V9H20v12z', CC],
    ['M10.3 15.5h3.4V21h-3.4z', SHADE],
    ['M11.4 2.5h1.2v6.5h-1.2zM12.6 2.5h4.4l-1.3 1.3L17 5h-4.4z', CC],
  ],
  house: [['M4 11l8-7 8 7v10H4z', CC], ['M10 15h4v6h-4z', SHADE]],
  tower: [['M7 21V6l5-3.5L17 6v15z', CC], ['M9 8h2v2H9zM13 8h2v2h-2zM9 12h2v2H9zM13 12h2v2h-2zM9 16h2v2H9zM13 16h2v2h-2z', SHADE]],
  star: [['M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z', CC]],
  swords: [
    ['M3 3l2.5.5 9 9-1.8 1.8-9-9zM21 3l-.5 2.5-9 9-1.8-1.8 9-9z', CC],
    ['M5.5 13.5l1.4-1.4 4.6 4.6-1.4 1.4zM18.5 13.5l-1.4-1.4-4.6 4.6 1.4 1.4zM3.5 19l3-3 1.5 1.5-3 3zM20.5 19l-3-3-1.5 1.5 3 3z', CC],
  ],
  clouds: [['M7 19a5 5 0 0 1-.9-9.9A6.5 6.5 0 0 1 18.6 9.6 4.7 4.7 0 0 1 18 19z', CC]],
  political: [['M4 4l5 2 6-2 5 2v14l-5-2-6 2-5-2z', '#e2574c'], ['M9 6l6-2v14l-6 2z', '#4b8bd6'], ['M15 4l5 2v14l-5-2z', '#5fb85b']],
  satellite: [
    ['M12 2.5a9.5 9.5 0 1 1-.01 0z', '#2c6fb8'],
    ['M6 7c2 1 2.5 3 4.5 3.3S12 13 10 14.5 7 17 5.4 15.2C3.8 12.6 4 9 6 7zM14 4.5c1.5 1.5 4 2 5.2 4.2 1 2.2-.6 3.6-2.4 3.3-1.6-.3-2.2 2.2-.6 3.5 1.1 1 .3 3.2-1.4 3.6-1.1-1.5-.6-3.6-2-4.8-1.2-1-2.4-2.8-.5-4.4 1.4-1.2 1.3-3.6 1.7-5.4z', '#56b65a'],
  ],
  terrain: [['M1.5 20l7-12 4 6 3-4 7 10z', '#8a7a5c'], ['M8.5 8l2.2 3.6-1 1.3-1.2-1.6-1.2 1.6-1-1.2z', '#f4f1ea'], ['M1.5 20h21v1.5h-21z', '#5fa35a']],
};

/** Map-marker icon per era and unit role. */
const UNIT_ICON = {
  rome: { inf: 'scutum', rng: 'bow', mob: 'horse', nav: 'galley' },
  medieval: { inf: 'kite', rng: 'bow', mob: 'greathelm', nav: 'cog' },
  ww1: { inf: 'brodie', rng: 'fieldgun', mob: 'horse', nav: 'warship' },
  ww2: { inf: 'stahlhelm', rng: 'fieldgun', mob: 'tank', nav: 'warship' },
  coldwar: { inf: 'apc', rng: 'howitzer', mob: 'mbt', nav: 'warship' },
  modern: { inf: 'combat', rng: 'rocket', mob: 'mbt', nav: 'warship' },
};
UNIT_ICON.fictional = UNIT_ICON.modern;
export const unitIcon = (eraId, role) => (UNIT_ICON[eraId] ?? UNIT_ICON.modern)[role] ?? 'scutum';

/** Building type → icon (Mine is a pickaxe before the industrial eras). */
export const buildingIcon = (type, industrial) => ({ farm: 'farm', mine: industrial ? 'factory' : 'mine', oilwell: 'oilwell', barracks: 'barracks', port: 'port', fort: 'fort', roads: 'roads' })[type] ?? 'fort';

/** Inline SVG for the HUD. */
export function svgIcon(name, cls = 'ico', title = '') {
  const layers = ICONS[name] ?? ICONS.star;
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="${title ? 'false' : 'true'}"${title ? ` role="img" aria-label="${title}"` : ''}>${layers.map(([d, f]) => `<path d="${d}" fill="${f}"/>`).join('')}</svg>`;
}

const pathCache = new Map();
function paths(name) {
  if (!pathCache.has(name)) pathCache.set(name, (ICONS[name] ?? ICONS.star).map(([d, f]) => [new Path2D(d), f]));
  return pathCache.get(name);
}

/** Draw an icon centred at (x, y), `size` px tall, on a canvas. */
export function drawIcon(ctx, name, x, y, size, color = '#fff') {
  const s = size / 24;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(s, s);
  for (const [p, f] of paths(name)) {
    ctx.fillStyle = f === CC ? color : f;
    ctx.fill(p);
  }
  ctx.restore();
}

// --- Era-aware HUD icons -------------------------------------------------------

let iconEra = 'ww2', iconIndustrial = true;
/** Which era's unit and building pictures the HUD shows (set when a map loads). */
export function setIconEra(eraId) {
  iconEra = eraId ?? 'modern';
  iconIndustrial = !['rome', 'medieval'].includes(iconEra);
}
/** Inline SVG of a unit role (Legion shield in Rome, tank in WWII…). */
export const roleIcon = (role) => svgIcon(unitIcon(iconEra, role), 'ico ico-unit');
/** Inline SVG of a building type. */
export const buildingSvg = (type) => svgIcon(buildingIcon(type, iconIndustrial), 'ico ico-bld');
/** Inline SVG of a resource (gold coin, grain, steel ingot, oil barrel…). */
export const resourceSvg = (key) => svgIcon(key, 'ico ico-res');
