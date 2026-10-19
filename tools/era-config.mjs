/**
 * era-config.mjs — Hand-curated knowledge used by tools/build-eras.mjs.
 *
 * Per era: source file, sovereignty fixes (aliases), name overrides, major
 * powers, real capitals, and (for pre-modern eras) a curated list of major
 * cities. Coordinates are [lat, lon] in degrees.
 *
 * Group keys are the dataset's sovereign identifiers: historical-basemaps
 * SUBJECTO (falling back to NAME), Natural Earth SOVEREIGNT.
 */

const HB = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson';
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

export const SOURCES = {
  hb: {
    name: 'historical-basemaps (A. Ourednik)',
    url: 'https://github.com/aourednik/historical-basemaps',
    license: 'GPL-3.0',
  },
  ne: {
    name: 'Natural Earth 1:10m admin-1 regions, 1:50m countries + populated places',
    url: 'https://www.naturalearthdata.com',
    license: 'Public domain',
  },
};

export const NE_PLACES = { file: 'ne_50m_populated_places_simple.geojson', url: `${NE}/ne_50m_populated_places_simple.geojson` };

/**
 * Names in historical-basemaps that describe peoples or cultures rather than
 * states. Their land becomes unclaimed territory (owner -1) that keeps the
 * name as a region label.
 */
export const NON_STATE_RE =
  /hunter|gatherer|cultur|peoples|tribes|farmers|foraging|fishers|fichers|shellfish|complex$|focus$|burials|khoisan|aboriginal|paleo-|papuans|^malays$|polynesians|^dorset$|^thule$|athabaskan|^innu$|arawaks|^taino$|boethuk|guanahatabeyes|^saami$|^sámi$|^ainu$|^copena$|^porter$|^miller$|mill creek/i;

/** Cities that did not exist (or were negligible) before a given year. */
export const FOUNDED = {
  brasilia: 1960, abuja: 1980, islamabad: 1961, naypyidaw: 2005, shenzhen: 1980, chandigarh: 1952,
  gaborone: 1965, nouakchott: 1958, putrajaya: 1995, belmopan: 1970, dodoma: 1973, yamoussoukro: 1983,
  canberra: 1927, astana: 1997, dongguan: 1985, amaravati: 2015, navimumbai: 1990,
};

/**
 * Era names for modern cities (keyed by normalized ASCII name).
 * Missing era → modern name.
 */
export const RENAMES = {
  stpetersburg: { ww1: 'Petrograd', ww2: 'Leningrad', coldwar: 'Leningrad' },
  istanbul: { ww1: 'Constantinople' },
  beijing: { ww1: 'Peking', ww2: 'Peiping', coldwar: 'Peking' },
  ulaanbaatar: { ww1: 'Urga', ww2: 'Ulan Bator', coldwar: 'Ulan Bator' },
  jakarta: { ww1: 'Batavia', ww2: 'Batavia', coldwar: 'Djakarta' },
  hochiminhcity: { ww1: 'Saigon', ww2: 'Saigon', coldwar: 'Saigon' },
  mumbai: { ww1: 'Bombay', ww2: 'Bombay', coldwar: 'Bombay' },
  chennai: { ww1: 'Madras', ww2: 'Madras', coldwar: 'Madras' },
  kolkata: { ww1: 'Calcutta', ww2: 'Calcutta', coldwar: 'Calcutta' },
  bengaluru: { ww1: 'Bangalore', ww2: 'Bangalore', coldwar: 'Bangalore' },
  pune: { ww1: 'Poona', ww2: 'Poona', coldwar: 'Poona' },
  kanpur: { ww1: 'Cawnpore', ww2: 'Cawnpore', coldwar: 'Kanpur' },
  yangon: { ww1: 'Rangoon', ww2: 'Rangoon', coldwar: 'Rangoon' },
  rangoon: { ww1: 'Rangoon', ww2: 'Rangoon', coldwar: 'Rangoon', modern: 'Yangon' },
  dhaka: { ww1: 'Dacca', ww2: 'Dacca', coldwar: 'Dacca' },
  chattogram: { ww1: 'Chittagong', ww2: 'Chittagong', coldwar: 'Chittagong' },
  kinshasa: { ww1: 'Léopoldville', ww2: 'Léopoldville', coldwar: 'Léopoldville' },
  lubumbashi: { ww1: 'Élisabethville', ww2: 'Élisabethville', coldwar: 'Élisabethville' },
  kisangani: { ww1: 'Stanleyville', ww2: 'Stanleyville', coldwar: 'Stanleyville' },
  harare: { ww1: 'Salisbury', ww2: 'Salisbury', coldwar: 'Salisbury' },
  maputo: { ww1: 'Lourenço Marques', ww2: 'Lourenço Marques', coldwar: 'Lourenço Marques' },
  ndjamena: { ww1: 'Fort-Lamy', ww2: 'Fort-Lamy', coldwar: 'Fort-Lamy' },
  banjul: { ww1: 'Bathurst', ww2: 'Bathurst', coldwar: 'Bathurst' },
  malabo: { ww1: 'Santa Isabel', ww2: 'Santa Isabel', coldwar: 'Santa Isabel' },
  volgograd: { ww1: 'Tsaritsyn', ww2: 'Stalingrad', coldwar: 'Stalingrad' },
  gdansk: { ww1: 'Danzig', ww2: 'Danzig' },
  kaliningrad: { ww1: 'Königsberg', ww2: 'Königsberg' },
  lviv: { ww1: 'Lemberg', ww2: 'Lwów', coldwar: 'Lvov' },
  vilnius: { ww1: 'Vilna', ww2: 'Wilno' },
  kiev: { ww1: 'Kiev', ww2: 'Kiev', coldwar: 'Kiev', modern: 'Kyiv' },
  tbilisi: { ww1: 'Tiflis' },
  nizhnynovgorod: { ww2: 'Gorky', coldwar: 'Gorky' },
  yekaterinburg: { ww2: 'Sverdlovsk', coldwar: 'Sverdlovsk' },
  samara: { ww2: 'Kuybyshev', coldwar: 'Kuybyshev' },
  donetsk: { ww1: 'Yuzovka', ww2: 'Stalino', coldwar: 'Stalino' },
  almaty: { ww1: 'Verny', ww2: 'Alma-Ata', coldwar: 'Alma-Ata' },
  bishkek: { ww1: 'Pishpek', ww2: 'Frunze', coldwar: 'Frunze' },
  dushanbe: { ww2: 'Stalinabad', coldwar: 'Stalinabad' },
  tallinn: { ww1: 'Reval' },
  helsinki: { ww1: 'Helsingfors' },
  oslo: { ww1: 'Kristiania' },
  bratislava: { ww1: 'Pressburg' },
  ljubljana: { ww1: 'Laibach' },
  chisinau: { ww1: 'Kishinev', ww2: 'Kishinev', coldwar: 'Kishinev' },
  seoul: { ww1: 'Keijō', ww2: 'Keijō' },
  busan: { ww1: 'Fusan', ww2: 'Fusan' },
  taipei: { ww1: 'Taihoku', ww2: 'Taihoku' },
  kaohsiung: { ww1: 'Takao', ww2: 'Takao' },
  guangzhou: { ww1: 'Canton', ww2: 'Canton', coldwar: 'Canton' },
  nanjing: { ww1: 'Nanking', ww2: 'Nanking', coldwar: 'Nanking' },
  chongqing: { ww1: 'Chungking', ww2: 'Chungking', coldwar: 'Chungking' },
  tianjin: { ww1: 'Tientsin', ww2: 'Tientsin', coldwar: 'Tientsin' },
  shenyeng: { ww1: 'Mukden', ww2: 'Mukden', coldwar: 'Shenyang', modern: 'Shenyang' },
  wuhan: { ww1: 'Hankow', ww2: 'Hankow', coldwar: 'Wuhan' },
  xian: { ww1: "Sian", ww2: "Sian", coldwar: "Sian", modern: "Xi'an" },
  dalian: { ww1: 'Dairen', ww2: 'Dairen', coldwar: 'Dalian' },
  harbin: { ww1: 'Harbin' },
  changchun: { ww2: 'Hsinking' },
  urumqi: { ww1: 'Tihwa', ww2: 'Tihwa', coldwar: 'Urumqi' },
  izmir: { ww1: 'Smyrna' },
  ankara: { ww1: 'Angora' },
  thessaloniki: { ww1: 'Salonica' },
  nuuk: { ww1: 'Godthåb', ww2: 'Godthåb', coldwar: 'Godthåb' },
  georgetown: {},
  hanoi: {},
};

// --- Shared capital coordinates for the 20th century -----------------------

const C = {
  london: ['London', 51.507, -0.128], paris: ['Paris', 48.857, 2.352], berlin: ['Berlin', 52.52, 13.405],
  vienna: ['Vienna', 48.208, 16.373], rome: ['Rome', 41.903, 12.496], madrid: ['Madrid', 40.417, -3.704],
  lisbon: ['Lisbon', 38.722, -9.139], brussels: ['Brussels', 50.85, 4.352], amsterdam: ['Amsterdam', 52.37, 4.895],
  copenhagen: ['Copenhagen', 55.676, 12.568], stockholm: ['Stockholm', 59.329, 18.069], bern: ['Bern', 46.948, 7.447],
  washington: ['Washington', 38.907, -77.037], tokyo: ['Tokyo', 35.676, 139.65], moscow: ['Moscow', 55.756, 37.617],
  stpete: ['St. Petersburg', 59.939, 30.316], constantinople: ['Constantinople', 41.008, 28.978],
  ankara: ['Ankara', 39.934, 32.86], athens: ['Athens', 37.984, 23.728], sofia: ['Sofia', 42.698, 23.322],
  bucharest: ['Bucharest', 44.427, 26.103], belgrade: ['Belgrade', 44.787, 20.457], budapest: ['Budapest', 47.498, 19.04],
  prague: ['Prague', 50.075, 14.438], warsaw: ['Warsaw', 52.23, 21.012], oslo: ['Oslo', 59.914, 10.752],
  helsinki: ['Helsinki', 60.17, 24.938], tallinn: ['Tallinn', 59.437, 24.754], riga: ['Riga', 56.95, 24.105],
  kaunas: ['Kaunas', 54.899, 23.903], dublin: ['Dublin', 53.35, -6.26], ottawa: ['Ottawa', 45.421, -75.697],
  rio: ['Rio de Janeiro', -22.907, -43.173], brasilia: ['Brasília', -15.794, -47.882],
  melbourne: ['Melbourne', -37.814, 144.963], canberra: ['Canberra', -35.281, 149.13],
  peking: ['Peking', 39.904, 116.407], nanking: ['Nanking', 32.06, 118.797], chungking: ['Chungking', 29.563, 106.551],
  bangkok: ['Bangkok', 13.756, 100.502], tehran: ['Tehran', 35.689, 51.389], kabul: ['Kabul', 34.555, 69.207],
  addis: ['Addis Ababa', 9.03, 38.74], riyadh: ['Riyadh', 24.713, 46.675], cairo: ['Cairo', 30.044, 31.236],
  lhasa: ['Lhasa', 29.65, 91.1], urga: ['Urga', 47.886, 106.906], ulanbator: ['Ulan Bator', 47.886, 106.906],
  mexico: ['Mexico City', 19.433, -99.133], buenosaires: ['Buenos Aires', -34.604, -58.382],
  newdelhi: ['New Delhi', 28.614, 77.209], karachi: ['Karachi', 24.861, 67.01], rawalpindi: ['Rawalpindi', 33.6, 73.05],
  bonn: ['Bonn', 50.737, 7.098], eastberlin: ['East Berlin', 52.52, 13.405],
};

// --- Eras ---------------------------------------------------------------------


/**
 * Key cities of the 20th-century major powers. The automatic city pick uses
 * today's populations, which drops historic industrial centres (Hamburg,
 * Essen, Manchester…) below modern megacities; these lists make sure each
 * major power has its real cities. Cities outside the country in a given
 * era are skipped by the build.
 */
const K = {
  hamburg: ['Hamburg', 53.55, 10.0], munich: ['Munich', 48.14, 11.58], cologne: ['Cologne', 50.94, 6.96], frankfurt: ['Frankfurt', 50.11, 8.68],
  essen: ['Essen', 51.46, 7.01], stuttgart: ['Stuttgart', 48.78, 9.18], dresden: ['Dresden', 51.05, 13.74], leipzig: ['Leipzig', 51.34, 12.37],
  breslau: ['Breslau', 51.11, 17.03], konigsberg: ['Königsberg', 54.71, 20.51], hanover: ['Hanover', 52.37, 9.73], nuremberg: ['Nuremberg', 49.45, 11.08],
  bremen: ['Bremen', 53.08, 8.8], dusseldorf: ['Düsseldorf', 51.23, 6.78], danzig: ['Danzig', 54.35, 18.65], posen: ['Posen', 52.41, 16.93], strassburg: ['Strassburg', 48.57, 7.75],
  birmingham: ['Birmingham', 52.48, -1.9], manchester: ['Manchester', 53.48, -2.24], liverpool: ['Liverpool', 53.41, -2.98], glasgow: ['Glasgow', 55.86, -4.25],
  edinburgh: ['Edinburgh', 55.95, -3.19], leeds: ['Leeds', 53.8, -1.55], sheffield: ['Sheffield', 53.38, -1.47], bristol: ['Bristol', 51.45, -2.59],
  newcastle: ['Newcastle', 54.98, -1.62], belfast: ['Belfast', 54.6, -5.93], cardiff: ['Cardiff', 51.48, -3.18], dublin: ['Dublin', 53.35, -6.26],
  lyon: ['Lyon', 45.76, 4.84], marseille: ['Marseille', 43.3, 5.37], lille: ['Lille', 50.63, 3.06], bordeaux: ['Bordeaux', 44.84, -0.58], toulouse: ['Toulouse', 43.6, 1.44],
  nantes: ['Nantes', 47.22, -1.55], strasbourg: ['Strasbourg', 48.57, 7.75], nice: ['Nice', 43.7, 7.27], lehavre: ['Le Havre', 49.49, 0.11], algiers: ['Algiers', 36.75, 3.06],
  kiev: ['Kiev', 50.45, 30.52], kharkov: ['Kharkov', 49.99, 36.23], odessa: ['Odessa', 46.48, 30.73], warsaw: ['Warsaw', 52.23, 21.01], riga: ['Riga', 56.95, 24.11],
  baku: ['Baku', 40.41, 49.87], tiflis: ['Tiflis', 41.72, 44.79], kazan: ['Kazan', 55.79, 49.12], rostov: ['Rostov', 47.24, 39.71], tashkent: ['Tashkent', 41.3, 69.24],
  vladivostok: ['Vladivostok', 43.12, 131.89], minsk: ['Minsk', 53.9, 27.57], novosibirsk: ['Novosibirsk', 55.03, 82.92], omsk: ['Omsk', 54.99, 73.37], krasnoyarsk: ['Krasnoyarsk', 56.02, 92.89],
  newyork: ['New York', 40.71, -74.0], chicago: ['Chicago', 41.88, -87.63], losangeles: ['Los Angeles', 34.05, -118.24], philadelphia: ['Philadelphia', 39.95, -75.17],
  detroit: ['Detroit', 42.33, -83.05], boston: ['Boston', 42.36, -71.06], sanfrancisco: ['San Francisco', 37.77, -122.42], pittsburgh: ['Pittsburgh', 40.44, -80.0],
  stlouis: ['St. Louis', 38.63, -90.2], houston: ['Houston', 29.76, -95.37], seattle: ['Seattle', 47.61, -122.33], neworleans: ['New Orleans', 29.95, -90.07],
  atlanta: ['Atlanta', 33.75, -84.39], dallas: ['Dallas', 32.78, -96.8], miami: ['Miami', 25.76, -80.19],
  osaka: ['Osaka', 34.69, 135.5], nagoya: ['Nagoya', 35.18, 136.91], yokohama: ['Yokohama', 35.44, 139.64], kyoto: ['Kyoto', 35.01, 135.77], kobe: ['Kobe', 34.69, 135.2],
  fukuoka: ['Fukuoka', 33.59, 130.4], hiroshima: ['Hiroshima', 34.39, 132.46], sapporo: ['Sapporo', 43.06, 141.35], sendai: ['Sendai', 38.27, 140.87],
  keijo: ['Keijō', 37.57, 126.98], taihoku: ['Taihoku', 25.03, 121.57],
  milan: ['Milan', 45.46, 9.19], naples: ['Naples', 40.85, 14.27], turin: ['Turin', 45.07, 7.69], genoa: ['Genoa', 44.41, 8.93], palermo: ['Palermo', 38.12, 13.36],
  florence: ['Florence', 43.77, 11.26], venice: ['Venice', 45.44, 12.32], bologna: ['Bologna', 44.49, 11.34], bari: ['Bari', 41.12, 16.87], trieste: ['Trieste', 45.65, 13.78],
  budapest: ['Budapest', 47.5, 19.04], prague: ['Prague', 50.08, 14.44], krakow: ['Kraków', 50.06, 19.94], lemberg: ['Lemberg', 49.84, 24.03], zagreb: ['Zagreb', 45.81, 15.98],
  brunn: ['Brünn', 49.2, 16.61], sarajevo: ['Sarajevo', 43.86, 18.41],
  smyrna: ['Smyrna', 38.42, 27.14], baghdad: ['Baghdad', 33.31, 44.36], damascus: ['Damascus', 33.51, 36.29], aleppo: ['Aleppo', 36.2, 37.13], beirut: ['Beirut', 33.89, 35.5],
  jerusalem: ['Jerusalem', 31.78, 35.23], angora: ['Angora', 39.93, 32.86], trebizond: ['Trebizond', 41.0, 39.72], mosul: ['Mosul', 36.34, 43.13],
  shanghai: ['Shanghai', 31.23, 121.47], chongqing: ['Chongqing', 29.56, 106.55], wuhan: ['Wuhan', 30.59, 114.3], guangzhou: ['Guangzhou', 23.13, 113.26],
  chengdu: ['Chengdu', 30.66, 104.07], xian: ["Xi'an", 34.34, 108.94], changsha: ['Changsha', 28.23, 112.94], kunming: ['Kunming', 25.04, 102.71],
  tianjin: ['Tianjin', 39.14, 117.18], nanjing: ['Nanjing', 32.06, 118.8], shenyang: ['Shenyang', 41.8, 123.43], harbin: ['Harbin', 45.8, 126.53],
  hangzhou: ['Hangzhou', 30.27, 120.15], shenzhen: ['Shenzhen', 22.54, 114.06], peiping: ['Peiping', 39.9, 116.4],
  bombay: ['Bombay', 19.08, 72.88], calcutta: ['Calcutta', 22.57, 88.36], madras: ['Madras', 13.08, 80.27], bangalore: ['Bangalore', 12.97, 77.59],
  hyderabad: ['Hyderabad', 17.39, 78.49], ahmedabad: ['Ahmedabad', 23.02, 72.57], pune: ['Pune', 18.52, 73.86], kanpur: ['Kanpur', 26.45, 80.33], lucknow: ['Lucknow', 26.85, 80.95],
};
const n = (city, name) => [name, city[1], city[2]];

export const ERAS = [
  {
    id: 'rome', source: 'hb', dataYear: 100, file: 'world_100.geojson', url: `${HB}/world_100.geojson`,
    aliases: {},
    majors: ['Roman Empire', 'Parthian Empire', 'Han', 'Kushan Empire', 'Satavahanihara', 'Axum', 'Koguryo', 'Saka Kingdom'],
    names: { Han: 'Han Empire', Satavahanihara: 'Satavahana Empire', Koguryo: 'Goguryeo', 'S. Xiongnu': 'Southern Xiongnu' },
    shortNames: { Han: 'Han Empire', Satavahanihara: 'Satavahana', Koguryo: 'Goguryeo', 'S. Xiongnu': 'S. Xiongnu' },
    colors: { 'Roman Empire': '#9b2d30', 'Parthian Empire': '#3f6a8a', Han: '#c9963a', 'Kushan Empire': '#7f5ea8', Satavahanihara: '#3e8f78', Axum: '#a8743a' },
    capitals: {
      'Roman Empire': ['Roma', 41.893, 12.483], 'Parthian Empire': ['Ctesiphon', 33.094, 44.581], Han: ["Luoyang", 34.62, 112.45],
      'Kushan Empire': ['Purushapura', 34.008, 71.578], Satavahanihara: ['Pratishthana', 19.48, 75.38], Axum: ['Aksum', 14.13, 38.72],
      Meroe: ['Meroë', 16.94, 33.75], 'Himyarite Kingdom': ['Ẓafār', 14.21, 44.4], Hadramaut: ['Shabwa', 15.39, 47.02],
      'Nabatean Kingdom': ['Petra', 30.329, 35.444], Armenia: ['Artaxata', 39.88, 44.58], Dacia: ['Sarmizegetusa', 45.62, 23.31],
      Koguryo: ['Gungnae', 41.13, 126.18], Silla: ['Seorabeol', 35.84, 129.21], Paekche: ['Wiryeseong', 37.52, 127.11],
      Gaya: ['Gimhae', 35.23, 128.88], Teotihuacan: ['Teotihuacan', 19.69, -98.84], 'Monte Albán': ['Monte Albán', 17.04, -96.77],
      Moche: ['Moche', -8.13, -79.0], Nazca: ['Cahuachi', -14.82, -75.12], Simhala: ['Anuradhapura', 8.35, 80.39],
      Kalinga: ['Kalinganagara', 20.22, 85.86], 'Saka Kingdom': ['Ujjayini', 23.18, 75.78], Scythians: ['Neapolis Scythica', 44.95, 34.1],
      Arakan: ['Dhanyawadi', 20.86, 93.06], 'S. Xiongnu': ['Meiji', 39.0, 110.0], Yayoi: ['Yoshinogari', 33.32, 130.38],
    },
    cities: [
      ['Alexandria', 31.2, 29.92], ['Antiochia', 36.2, 36.16], ['Carthago', 36.85, 10.32], ['Ephesus', 37.94, 27.34],
      ['Byzantium', 41.01, 28.98], ['Athenae', 37.98, 23.73], ['Londinium', 51.51, -0.09], ['Lugdunum', 45.76, 4.83],
      ['Lutetia', 48.85, 2.35], ['Colonia Agrippina', 50.94, 6.96], ['Augusta Treverorum', 49.75, 6.64], ['Mediolanum', 45.46, 9.19],
      ['Aquileia', 45.77, 13.37], ['Tarraco', 41.12, 1.25], ['Corduba', 37.88, -4.78], ['Gades', 36.53, -6.29],
      ['Caesarea', 32.5, 34.89], ['Hierosolyma', 31.78, 35.23], ['Damascus', 33.51, 36.29], ['Palmyra', 34.55, 38.27],
      ['Seleucia', 33.1, 44.52], ['Ecbatana', 34.8, 48.52], ['Merv', 37.66, 62.19], ['Taxila', 33.74, 72.79],
      ['Mathura', 27.49, 77.67], ['Pataliputra', 25.61, 85.14], ["Chang'an", 34.27, 108.95], ['Linzi', 36.82, 118.3],
      ['Panyu', 23.13, 113.26], ['Chengdu', 30.66, 104.06], ['Thessalonica', 40.64, 22.94], ['Leptis Magna', 32.64, 14.29],
      ['Emerita Augusta', 38.92, -6.34], ['Sirmium', 44.97, 19.61], ['Muziris', 10.15, 76.21], ['Madurai', 9.93, 78.12],
      ['Panticapaeum', 45.35, 36.47], ['Bactra', 36.76, 66.9], ['Gerrha', 25.4, 49.6], ['Kaveripattinam', 11.15, 79.85],
    ],
  },
  {
    id: 'medieval', source: 'hb', dataYear: 1200, file: 'world_1200.geojson', url: `${HB}/world_1200.geojson`,
    aliases: {},
    majors: ['Holy Roman Empire', 'Byzantine Empire', 'France', 'Angevin Empire', 'Song Empire', 'Mongol Empire', 'Khwarazmian dynasty', 'Almohad Caliphate'],
    names: { France: 'Kingdom of France', 'Imperial Japan (Fujiwara)': 'Japan (Fujiwara)', Liao: 'Liao (Jin)', Britany: 'Brittany', Burgandy: 'Burgundy' },
    shortNames: { 'Imperial Japan (Fujiwara)': 'Japan', Liao: 'Liao', Britany: 'Brittany', Burgandy: 'Burgundy', 'Kara Khitai Khaganate': 'Kara Khitai', 'Principality of Vladimir-Suzdal': 'Vladimir-Suzdal', 'Principality of Galicia-Volhynia': 'Galicia-Volhynia' },
    colors: { 'Holy Roman Empire': '#c9a645', 'Byzantine Empire': '#7d4fa0', France: '#4d6fb8', 'Angevin Empire': '#b5523b', 'Song Empire': '#c9783a', 'Mongol Empire': '#6b8f3e', 'Khwarazmian dynasty': '#3c8f94', 'Almohad Caliphate': '#5d8f5a' },
    capitals: {
      'Holy Roman Empire': ['Aachen', 50.776, 6.084], 'Byzantine Empire': ['Constantinople', 41.008, 28.978], France: ['Paris', 48.857, 2.352],
      'Angevin Empire': ['London', 51.507, -0.128], 'Song Empire': ["Lin'an", 30.274, 120.155], 'Mongol Empire': ['Karakorum', 47.2, 102.82],
      'Khwarazmian dynasty': ['Gurganj', 42.33, 59.15], 'Almohad Caliphate': ['Marrakesh', 31.63, -7.99], 'Kara Khitai Khaganate': ['Balasagun', 42.75, 75.25],
      'Sultanate of Delhi': ['Delhi', 28.65, 77.23], 'Fatimid Caliphate': ['Cairo', 30.044, 31.236], 'Buwayhid Emirates': ['Shiraz', 29.59, 52.58],
      'Buyid dynasty': ['Baghdad', 33.315, 44.366], 'Ghaznavid Emirate': ['Ghazni', 33.55, 68.42], 'Rajput kingdoms': ['Ajmer', 26.45, 74.64],
      'Chola Empire': ['Thanjavur', 10.79, 79.14], 'Khmer Empire': ['Angkor', 13.41, 103.87], Bagan: ['Bagan', 21.17, 94.86],
      'Đại Việt': ['Thăng Long', 21.03, 105.85], 'Champa City States': ['Vijaya', 13.9, 109.1], 'Srivijaya Empire': ['Palembang', -2.99, 104.76],
      'East Java': ['Kediri', -7.82, 112.01], 'Nan Chao': ['Dali', 25.6, 100.27], Xixia: ['Xingqing', 38.47, 106.27], Liao: ['Zhongdu', 39.88, 116.35],
      Goryeo: ['Kaesong', 37.97, 126.55], 'Imperial Japan (Fujiwara)': ['Heian-kyō', 35.01, 135.77], Tibet: ['Lhasa', 29.65, 91.1],
      Nepal: ['Kathmandu', 27.7, 85.32], Georgia: ['Tbilisi', 41.72, 44.79], Armenia: ['Sis', 37.45, 35.82], Yemen: ["Sana'a", 15.37, 44.19],
      Makkura: ['Dongola', 18.22, 30.75], Alwa: ['Soba', 15.5, 32.68], Mali: ['Niani', 11.39, -8.38], Ghana: ['Koumbi Saleh', 15.77, -8.0],
      'Great Zimbabwe': ['Great Zimbabwe', -20.27, 30.93], 'Chimú Empire': ['Chan Chan', -8.11, -79.07], 'Huari Empire': ['Wari', -13.06, -74.2],
      'Tiahuanaco Empire': ['Tiwanaku', -16.55, -68.67], 'Toltec Empire': ['Tula', 20.06, -99.34], 'Maya city-states': ['Chichén Itzá', 20.68, -88.57],
      Portugal: ['Coimbra', 40.21, -8.43], León: ['León', 42.6, -5.57], Castilla: ['Toledo', 39.86, -4.02], Aragón: ['Zaragoza', 41.65, -0.88],
      Navarre: ['Pamplona', 42.81, -1.64], Poland: ['Kraków', 50.06, 19.94], Hungary: ['Esztergom', 47.79, 18.74],
      'Principality of Kyiv': ['Kiev', 50.45, 30.52], 'Principality of Novgorod': ['Novgorod', 58.52, 31.27],
      'Principality of Vladimir-Suzdal': ['Vladimir', 56.13, 40.41], 'Principality of Galicia-Volhynia': ['Halych', 49.12, 24.72],
      'Volga Bulgars': ['Bilär', 54.95, 50.38], 'Bulgar Khanate': ['Tarnovo', 43.08, 25.63], Scotland: ['Dunfermline', 56.07, -3.46],
      Norway: ['Bergen', 60.39, 5.32], Sweden: ['Sigtuna', 59.62, 17.72], Denmark: ['Roskilde', 55.64, 12.08], 'Papal States': ['Rome', 41.903, 12.496],
      Venice: ['Venice', 45.44, 12.33], Cyprus: ['Nicosia', 35.17, 33.36], Burgandy: ['Dijon', 47.32, 5.04], Britany: ['Rennes', 48.11, -1.68],
      'Duchy of Benevento': ['Benevento', 41.13, 14.78], 'Islamic city-states': ['Kilwa', -8.96, 39.51], Muscat: ['Muscat', 23.59, 58.41],
      Hadramaut: ['Shibam', 15.93, 48.63], 'Tuʻi Tonga Empire': ["Mu'a", -21.17, -175.12], 'Mon state': ['Thaton', 16.92, 97.37],
      Harapunchai: ['Lamphun', 18.58, 99.01], Kanem: ['Njimi', 14.0, 15.5], Takrur: ['Takrur', 16.5, -15.0],
    },
    cities: [
      ['Baghdad', 33.315, 44.366], ['Damascus', 33.51, 36.29], ['Aleppo', 36.2, 37.16], ['Jerusalem', 31.78, 35.23],
      ['Alexandria', 31.2, 29.92], ['Mecca', 21.42, 39.83], ['Samarkand', 39.65, 66.96], ['Bukhara', 39.77, 64.42],
      ['Herat', 34.35, 62.2], ['Isfahan', 32.65, 51.67], ['Antioch', 36.2, 36.16], ['Thessalonica', 40.64, 22.94],
      ['Naples', 40.85, 14.27], ['Palermo', 38.12, 13.36], ['Milan', 45.46, 9.19], ['Genoa', 44.41, 8.93], ['Pisa', 43.72, 10.4],
      ['Bruges', 51.21, 3.22], ['Cologne', 50.94, 6.96], ['Lübeck', 53.87, 10.69], ['Prague', 50.08, 14.44], ['Barcelona', 41.39, 2.17],
      ['Seville', 37.39, -5.98], ['Córdoba', 37.88, -4.78], ['Fez', 34.03, -5.0], ['Tunis', 36.81, 10.18], ['Kairouan', 35.68, 10.1],
      ['Mogadishu', 2.05, 45.32], ['Gao', 16.27, -0.04], ['Calicut', 11.26, 75.78], ['Varanasi', 25.32, 82.97], ['Lahore', 31.55, 74.34],
      ['Multan', 30.2, 71.47], ['Guangzhou', 23.13, 113.26], ['Quanzhou', 24.87, 118.68], ['Kaifeng', 34.8, 114.31], ['Chengdu', 30.66, 104.06],
      ['Jiankang', 32.06, 118.8], ['Kamakura', 35.32, 139.55], ['Cahokia', 38.66, -90.06], ['Novgorod-Seversky', 52.0, 33.26],
      ['Smolensk', 54.78, 32.05], ['Trebizond', 41.0, 39.72], ['Konya', 37.87, 32.48], ['Tabriz', 38.08, 46.29], ['Nishapur', 36.21, 58.8],
      ['Kanauj', 27.05, 79.92], ['Pagan', 21.17, 94.86], ['Hormuz', 27.1, 56.45], ['Zeila', 11.35, 43.47], ['Timbuktu', 16.77, -3.0],
    ],
  },
  {
    id: 'ww1', source: 'hb', dataYear: 1914, file: 'world_1914.geojson', url: `${HB}/world_1914.geojson`,
    aliases: { 'United Kingdom': 'United Kingdom of Great Britain and Ireland', 'German South-West Africa': 'German Empire', Kamerun: 'German Empire', Togoland: 'German Empire' },
    majors: ['United Kingdom of Great Britain and Ireland', 'France', 'Russia', 'German Empire', 'Austro-Hungarian Empire', 'Ottoman Empire', 'Italy', 'United States'],
    names: { Russia: 'Russian Empire', Italy: 'Kingdom of Italy', 'Manchu Empire': 'Republic of China', France: 'French Republic' },
    shortNames: { 'United Kingdom of Great Britain and Ireland': 'United Kingdom', 'Austro-Hungarian Empire': 'Austria-Hungary', 'Russia': 'Russia', 'Manchu Empire': 'China', 'Rattanakosin Kingdom': 'Siam', 'Arabia (Nejd)': 'Nejd' },
    colors: { 'United Kingdom of Great Britain and Ireland': '#c96f7f', France: '#4d6fb8', Russia: '#4f8a5e', 'German Empire': '#6b7280', 'Austro-Hungarian Empire': '#d4b45a', 'Ottoman Empire': '#9a8a4a', Italy: '#3e8f78', 'United States': '#6f8fc0', 'Empire of Japan': '#c96a3a' },
    majorCities: {
      'German Empire': [K.hamburg, K.munich, K.cologne, K.frankfurt, K.essen, K.stuttgart, K.dresden, K.leipzig, K.breslau, K.konigsberg, K.hanover, K.danzig, K.posen, K.strassburg],
      'United Kingdom of Great Britain and Ireland': [K.birmingham, K.manchester, K.liverpool, K.glasgow, K.edinburgh, K.leeds, K.sheffield, K.bristol, K.newcastle, K.belfast, K.cardiff, K.dublin],
      France: [K.lyon, K.marseille, K.lille, K.bordeaux, K.toulouse, K.nantes, K.nice, K.lehavre, K.algiers],
      Russia: [n(['', 55.76, 37.62], 'Moscow'), K.kiev, K.kharkov, K.odessa, K.warsaw, K.riga, K.baku, K.tiflis, K.kazan, n(['', 56.33, 44.0], 'Nizhny Novgorod'), n(['', 53.2, 50.15], 'Samara'), K.rostov, n(['', 56.84, 60.6], 'Yekaterinburg'), K.tashkent, K.vladivostok, K.minsk],
      'Austro-Hungarian Empire': [K.budapest, K.prague, K.krakow, K.lemberg, K.trieste, K.zagreb, K.brunn, K.sarajevo],
      'Ottoman Empire': [K.smyrna, K.baghdad, K.damascus, K.aleppo, K.beirut, K.jerusalem, K.angora, K.trebizond, K.mosul],
      Italy: [K.milan, K.naples, K.turin, K.genoa, K.palermo, K.florence, K.venice, K.bologna, K.bari],
      'United States': [K.newyork, K.chicago, K.philadelphia, K.detroit, K.boston, K.sanfrancisco, K.pittsburgh, K.stlouis, K.losangeles, K.neworleans, K.seattle, K.atlanta],
    },
    capitals: {
      'United Kingdom of Great Britain and Ireland': C.london, France: C.paris, Russia: ['Petrograd', 59.939, 30.316], 'German Empire': C.berlin,
      'Austro-Hungarian Empire': C.vienna, 'Ottoman Empire': C.constantinople, Italy: C.rome, 'United States': C.washington, 'Empire of Japan': C.tokyo,
      Belgium: C.brussels, Portugal: C.lisbon, Spain: C.madrid, Netherlands: C.amsterdam, Denmark: C.copenhagen, Sweden: C.stockholm, Switzerland: C.bern,
      'Manchu Empire': C.peking, Brazil: C.rio, Australia: C.melbourne, Mongolia: C.urga, Tibet: C.lhasa, Xinjiang: ['Tihwa', 43.8, 87.6],
      'Netherlands Indies': ['Batavia', -6.2, 106.85], Philippines: ['Manila', 14.6, 120.98], Malaya: ['Kuala Lumpur', 3.14, 101.69],
      Morocco: ['Rabat', 34.02, -6.84], Finland: ['Helsingfors', 60.17, 24.938], Norway: ['Kristiania', 59.914, 10.752], Albania: ['Durazzo', 41.32, 19.45],
      Montenegro: ['Cetinje', 42.39, 18.92], Bhutan: ['Punakha', 27.59, 89.86], Ceylon: ['Colombo', 6.93, 79.85], 'Rattanakosin Kingdom': C.bangkok,
      'Arabia (Nejd)': C.riyadh, Abyssinia: C.addis, Persia: C.tehran, Afghanistan: C.kabul, Georgia: ['Tiflis', 41.72, 44.79], Armenia: ['Erivan', 40.18, 44.51],
      Azerbaijan: ['Baku', 40.41, 49.87], 'Papua New Guinea': ['Port Moresby', -9.44, 147.18], Uganda: ['Entebbe', 0.06, 32.46],
      Romania: C.bucharest, Bulgaria: C.sofia, Serbia: C.belgrade, Greece: C.athens, Mexico: C.mexico, Argentina: C.buenosaires,
    },
  },
  {
    id: 'ww2', source: 'hb', dataYear: 1938, file: 'world_1938.geojson', url: `${HB}/world_1938.geojson`,
    aliases: { 'United Kingdom of Great Britain and Ireland': 'United Kingdom' },
    majors: ['Germany', 'United Kingdom', 'France', 'USSR', 'United States', 'Empire of Japan', 'Italy', 'Chinese warlords'],
    names: { 'Chinese warlords': 'Republic of China', Germany: 'German Reich', Italy: 'Kingdom of Italy', USSR: 'Soviet Union', Siam: 'Kingdom of Siam' },
    shortNames: { 'Chinese warlords': 'China', USSR: 'USSR', 'Empire of Japan': 'Japan', 'Union of South Africa': 'South Africa', 'Dominion of Newfoundland': 'Newfoundland', "Emirate of Bin Shal'an": "Bin Sha'lan" },
    colors: { Germany: '#6b7280', 'United Kingdom': '#c96f7f', France: '#4d6fb8', USSR: '#a8423a', 'United States': '#5f9a6a', 'Empire of Japan': '#d9a441', Italy: '#3e8f78', 'Chinese warlords': '#c8783a' },
    majorCities: {
      Germany: [K.hamburg, K.munich, K.cologne, K.frankfurt, K.essen, K.stuttgart, K.dresden, K.leipzig, K.breslau, K.konigsberg, K.hanover, K.nuremberg, K.bremen, n(['', 48.21, 16.37], 'Vienna')],
      'United Kingdom': [K.birmingham, K.manchester, K.liverpool, K.glasgow, K.edinburgh, K.leeds, K.sheffield, K.bristol, K.newcastle, K.belfast, K.cardiff],
      France: [K.lyon, K.marseille, K.lille, K.bordeaux, K.toulouse, K.nantes, K.strasbourg, K.nice, K.lehavre, K.algiers],
      USSR: [n(['', 59.94, 30.31], 'Leningrad'), K.kiev, K.kharkov, K.odessa, K.baku, K.tiflis, K.kazan, n(['', 56.33, 44.0], 'Gorky'), n(['', 53.2, 50.15], 'Kuybyshev'), K.rostov, n(['', 56.84, 60.6], 'Sverdlovsk'), K.novosibirsk, K.tashkent, K.vladivostok, K.minsk, n(['', 48.71, 44.51], 'Stalingrad')],
      'United States': [K.newyork, K.chicago, K.losangeles, K.philadelphia, K.detroit, K.boston, K.sanfrancisco, K.pittsburgh, K.stlouis, K.houston, K.seattle, K.neworleans, K.atlanta],
      'Empire of Japan': [K.osaka, K.nagoya, K.yokohama, K.kyoto, K.kobe, K.fukuoka, K.hiroshima, K.sapporo, K.sendai, K.keijo, K.taihoku],
      Italy: [K.milan, K.naples, K.turin, K.genoa, K.palermo, K.florence, K.venice, K.bologna, K.bari, K.trieste],
      'Chinese warlords': [K.shanghai, K.wuhan, K.guangzhou, K.chengdu, K.xian, K.changsha, K.kunming, K.nanjing, K.peiping],
    },
    capitals: {
      Germany: C.berlin, 'United Kingdom': C.london, France: C.paris, USSR: C.moscow, 'United States': C.washington, 'Empire of Japan': C.tokyo,
      Italy: C.rome, 'Chinese warlords': C.chungking, Belgium: C.brussels, Portugal: C.lisbon, Spain: C.madrid, Netherlands: C.amsterdam,
      Denmark: C.copenhagen, Sweden: C.stockholm, Switzerland: C.bern, Brazil: C.rio, Australia: C.canberra, Mongolia: C.ulanbator, Tibet: C.lhasa,
      Xinjiang: ['Tihwa', 43.8, 87.6], Turkey: C.ankara, Poland: C.warsaw, Czechoslovakia: C.prague, Hungary: C.budapest, Romania: C.bucharest,
      Yugoslavia: C.belgrade, Bulgaria: C.sofia, Greece: C.athens, Albania: ['Tirana', 41.33, 19.82], Finland: C.helsinki, Estonia: C.tallinn,
      Latvia: C.riga, Lithuania: ['Kaunas', 54.899, 23.903], Ireland: C.dublin, Norway: C.oslo, Siam: C.bangkok, Iran: C.tehran, Afghanistan: C.kabul,
      Egypt: C.cairo, 'Saudi Arabia': C.riyadh, India: C.newdelhi, 'Union of South Africa': ['Pretoria', -25.75, 28.19], Canada: C.ottawa,
      Mexico: C.mexico, Argentina: C.buenosaires, Ceylon: ['Colombo', 6.93, 79.85], Bhutan: ['Punakha', 27.59, 89.86], Libya: ['Tripoli', 32.89, 13.19],
      Sudan: ['Khartoum', 15.5, 32.56], 'Dominion of Newfoundland': ["St. John's", 47.56, -52.71], Israel: ['Jerusalem', 31.78, 35.23],
      Laos: ['Vientiane', 17.97, 102.6], Malawi: ['Zomba', -15.39, 35.32], Hejaz: ['Mecca', 21.42, 39.83], Hail: ["Ha'il", 27.52, 41.69],
    },
  },
  {
    id: 'coldwar', source: 'hb', dataYear: 1960, file: 'world_1960.geojson', url: `${HB}/world_1960.geojson`,
    aliases: {},
    majors: ['United States', 'USSR', 'China', 'United Kingdom', 'France', 'West Germany', 'Japan', 'India'],
    names: { USSR: 'Soviet Union', China: "People's Republic of China", Taiwan: 'Republic of China (Taiwan)', 'West Germany': 'Federal Republic of Germany', 'East Germany': 'German Democratic Republic', 'Korea, Republic of': 'South Korea', "Korea, Democratic People's Republic of": 'North Korea', 'Tanzania, United Republic of': 'Tanganyika', Zaire: 'Republic of the Congo (Léopoldville)', Congo: 'Republic of the Congo (Brazzaville)' },
    shortNames: { USSR: 'USSR', 'West Germany': 'W. Germany', 'East Germany': 'E. Germany', 'Korea, Republic of': 'S. Korea', "Korea, Democratic People's Republic of": 'N. Korea', 'Tanzania, United Republic of': 'Tanganyika', Zaire: 'Congo-Léo.', Congo: 'Congo-Brazza.' },
    colors: { 'United States': '#5f88c4', USSR: '#a8423a', China: '#c9683a', 'United Kingdom': '#c96f7f', France: '#4d74b0', 'West Germany': '#6b7f8c', Japan: '#d4a548', India: '#e0904a' },
    majorCities: {
      'West Germany': [K.hamburg, K.munich, K.cologne, K.frankfurt, K.essen, K.stuttgart, K.hanover, K.nuremberg, K.bremen, K.dusseldorf],
      'United Kingdom': [K.birmingham, K.manchester, K.liverpool, K.glasgow, K.edinburgh, K.leeds, K.sheffield, K.bristol, K.newcastle, K.belfast, K.cardiff],
      France: [K.lyon, K.marseille, K.lille, K.bordeaux, K.toulouse, K.nantes, K.strasbourg, K.nice, K.lehavre],
      USSR: [n(['', 59.94, 30.31], 'Leningrad'), K.kiev, K.kharkov, K.odessa, K.baku, K.tiflis, K.kazan, n(['', 56.33, 44.0], 'Gorky'), n(['', 53.2, 50.15], 'Kuybyshev'), K.rostov, n(['', 56.84, 60.6], 'Sverdlovsk'), K.novosibirsk, K.tashkent, K.vladivostok, K.minsk, n(['', 48.71, 44.51], 'Stalingrad')],
      'United States': [K.newyork, K.chicago, K.losangeles, K.philadelphia, K.detroit, K.boston, K.sanfrancisco, K.pittsburgh, K.stlouis, K.houston, K.seattle, K.dallas, K.atlanta],
      Japan: [K.osaka, K.nagoya, K.yokohama, K.kyoto, K.kobe, K.fukuoka, K.hiroshima, K.sapporo, K.sendai],
      China: [K.shanghai, K.tianjin, K.wuhan, K.guangzhou, K.chongqing, K.chengdu, K.xian, K.shenyang, K.harbin, K.nanjing],
      India: [K.bombay, K.calcutta, K.madras, K.bangalore, K.hyderabad, K.ahmedabad, K.kanpur, K.lucknow],
    },
    capitals: {
      'United States': C.washington, USSR: C.moscow, China: C.peking, 'United Kingdom': C.london, France: C.paris, 'West Germany': C.bonn,
      'East Germany': C.eastberlin, Japan: C.tokyo, India: C.newdelhi, Italy: C.rome, Brazil: C.brasilia, Australia: C.canberra, Pakistan: C.rawalpindi,
      Mongolia: C.ulanbator, Tibet: C.lhasa, Taiwan: ['Taipei', 25.03, 121.57], 'Korea, Republic of': ['Seoul', 37.57, 126.98],
      "Korea, Democratic People's Republic of": ['Pyongyang', 39.04, 125.76], Nigeria: ['Lagos', 6.46, 3.39], 'Ivory Coast': ['Abidjan', 5.36, -4.01],
      'Tanzania, United Republic of': ['Dar es Salaam', -6.79, 39.21], Malawi: ['Zomba', -15.39, 35.32], Burma: ['Rangoon', 16.87, 96.2],
      Belize: ['Belize City', 17.5, -88.2], 'Sri Lanka': ['Colombo', 6.93, 79.85], Zaire: ['Léopoldville', -4.32, 15.31], Botswana: ['Mafeking', -25.85, 25.64],
      Mauritania: ['Nouakchott', 18.08, -15.98], Netherlands: C.amsterdam, Turkey: C.ankara, Vietnam: ['Hanoi', 21.03, 105.85], Bhutan: ['Punakha', 27.59, 89.86],
      Laos: ['Vientiane', 17.97, 102.6], Libya: ['Tripoli', 32.89, 13.19], Israel: ['Jerusalem', 31.78, 35.23], Bolivia: ['La Paz', -16.5, -68.15],
      Greenland: ['Godthåb', 64.18, -51.72], Kazakhstan: ['Alma-Ata', 43.24, 76.89],
    },
  },
  {
    id: 'modern', source: 'ne', dataYear: 2024, file: 'ne_50m_admin_0_countries.geojson', url: `${NE}/ne_50m_admin_0_countries.geojson`,
    admin1: { file: 'ne_10m_admin_1_states_provinces.geojson', url: `${NE}/ne_10m_admin_1_states_provinces.geojson` },
    aliases: {},
    majors: ['United States of America', 'China', 'Russia', 'India', 'United Kingdom', 'France', 'Germany', 'Japan'],
    names: {},
    shortNames: { 'United States of America': 'United States', 'Democratic Republic of the Congo': 'DR Congo', 'Republic of the Congo': 'Congo', 'United Republic of Tanzania': 'Tanzania', 'Republic of Serbia': 'Serbia', 'Central African Republic': 'C. African Rep.', 'Bosnia and Herzegovina': 'Bosnia', 'Dominican Republic': 'Dominican Rep.' },
    colors: { 'United States of America': '#5f88c4', China: '#c9583a', Russia: '#4f8a6e', India: '#e0904a', 'United Kingdom': '#c96f7f', France: '#4d74b0', Germany: '#6b7f8c', Japan: '#d4a548' },
    majorCities: {
      Germany: [K.hamburg, K.munich, K.cologne, K.frankfurt, K.essen, K.stuttgart, K.dresden, K.leipzig, K.hanover, K.dusseldorf],
      'United Kingdom': [K.birmingham, K.manchester, K.liverpool, K.glasgow, K.edinburgh, K.leeds, K.bristol, K.newcastle, K.belfast, K.cardiff],
      France: [K.lyon, K.marseille, K.lille, K.bordeaux, K.toulouse, K.nantes, K.strasbourg, K.nice],
      Russia: [n(['', 59.94, 30.31], 'Saint Petersburg'), K.novosibirsk, n(['', 56.84, 60.6], 'Yekaterinburg'), K.kazan, n(['', 56.33, 44.0], 'Nizhny Novgorod'), n(['', 53.2, 50.15], 'Samara'), n(['', 47.24, 39.71], 'Rostov-on-Don'), n(['', 48.71, 44.51], 'Volgograd'), K.omsk, K.krasnoyarsk, K.vladivostok],
      'United States of America': [K.newyork, K.chicago, K.losangeles, K.philadelphia, K.detroit, K.boston, K.sanfrancisco, K.houston, K.seattle, K.dallas, K.atlanta, K.miami],
      Japan: [K.osaka, K.nagoya, K.yokohama, K.kyoto, K.kobe, K.fukuoka, K.hiroshima, K.sapporo, K.sendai],
      China: [K.shanghai, K.tianjin, K.wuhan, K.guangzhou, K.shenzhen, K.chongqing, K.chengdu, K.xian, K.shenyang, K.harbin, K.nanjing, K.hangzhou],
      India: [n(K.bombay, 'Mumbai'), n(K.calcutta, 'Kolkata'), n(K.madras, 'Chennai'), K.bangalore, K.hyderabad, K.ahmedabad, K.pune, K.kanpur, K.lucknow],
    },
    capitals: { Netherlands: C.amsterdam, 'Sri Lanka': ['Colombo', 6.93, 79.85], Bolivia: ['La Paz', -16.5, -68.15], 'South Africa': ['Pretoria', -25.75, 28.19], Israel: ['Jerusalem', 31.78, 35.23] },
  },
];
