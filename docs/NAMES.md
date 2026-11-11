# Province names

Every province in the real-world eras has a real name. Until step 13, the era
builder (`tools/build-eras.mjs`) named only city provinces from real data and
gave every other province an invented name from the Fictional World's syllable
generator: "Senven" and "Isheim" in 1200 Spain. Step 13 replaced those
invented names with real ones. The Fictional World keeps its generated names.

## Where names come from

| Province | Name |
|---|---|
| City province | The city, from the era's curated city list or Natural Earth populated places, in the era's spelling (`RENAMES` in `tools/era-config.mjs`: Breslau, Stalingrad, Léopoldville…). Unchanged in step 13, except a few duplicates (below). |
| Modern era | Natural Earth admin-1 regions (states, provinces, oblasts), split with a compass suffix where a region is large. Unchanged in step 13. |
| Any other province in Rome, Medieval, WWI, WWII, Cold War | Step 13, `tools/province-names.mjs`; see below. |

For a province without a city, the first rule that gives an unused name wins:

1. **A historical place inside the province.**
   - **Rome (AD 117):** a [Pleiades](https://pleiades.stoa.org) place with a
     name attested in the Roman period in an ancient language. Latin first,
     then unlabeled ancient names, then Greek. Settlements come before peoples
     and regions. Places with more attested names come first, as a measure of
     importance: Tolosa, Massalia, Conimbriga, Siscia, Augusta Vindelicum.
     Pleiades titles alone aren't used, because unnamed sites carry modern
     labels ("Les Castels").
   - **Medieval (1200):** a Natural Earth town, but only in the long-settled
     parts of Afro-Eurasia: Europe west of the Volga, North Africa, the Near
     and Middle East, South Asia, East Asia and Japan. Towns founded after 1200
     are left out (Berlin, Warsaw, Stockholm, Odessa, Singapore…). Medieval
     names are used where they differ: Constantinople, Smyrna, Adrianople,
     Trebizond, Kiev, Zhongdu, Jiankang, Lin'an, Acre, Tyre. In Castile this
     gives Burgos, Palencia, Segovia, Santander and Cantabria.
   - **WWI (1914), WWII (1938), Cold War (1960):** a Natural Earth town that
     existed that year (`FOUNDED`), in that year's spelling (`RENAMES`):
     Stettin, Allenstein, Lemberg/Lwów, Tananarive, Fort-Dauphin, Lyallpur.
2. **The modern region (Natural Earth admin-1)**, when the province is the only
   one in that region still needing a name: "Gers", "Meuse", "Leh". It is
   spelled the era's way where a town of that name was called otherwise
   (Istanbul becomes Constantinople).
3. **A physical feature lying mostly in the province:** a Natural Earth
   geographic region, river or lake ("Central Siberian Plateau", "Verkhoyansk
   Range", "Vilyuy", "Lapland", "Lake Martre"). Each feature names one
   province: the one holding most of it.
4. **The nearest unused town of the era within about 200 km.**
5. **The admin-1 region with a compass suffix:** "Krasnoyarsk North",
   "Nunavut Central 6". Common administrative suffixes are dropped (Krai,
   Oblast, Republic, National Park). This is the last resort, used mostly in
   huge, nearly empty regions: the Arctic, Greenland, Siberia and the
   Sahara.

**Duplicate city names.** A few provinces in the original builds had a city
name that another province also used: a Bulgarian sliver called
"Constantinople" in 1914, two "Niamey"s, a Malayan capital called "Bandar Seri
Begawan" in 1960. The province that really holds the town keeps the name; the
others get a town inside them, or are named after the real city with a
direction ("Constantinople Northwest").

## Before and after

Counts are provinces per era. "Real place" covers city names, plus the
historical places from rule 1 and nearby towns from rule 4.

| Era | Provinces | Invented before | Invented after | Real place | Physical feature | Modern region (plain / with compass) |
|---|---:|---:|---:|---:|---:|---:|
| Rome | 3,601 | 3,537 | 0 | 808 | 1,143 | 420 / 1,230 |
| Medieval | 3,602 | 3,485 | 0 | 1,250 | 1,036 | 373 / 943 |
| WWI | 3,614 | 3,339 | 0 | 2,381 | 553 | 158 / 522 |
| WWII | 3,616 | 3,335 | 0 | 2,365 | 541 | 178 / 532 |
| Cold War | 3,613 | 3,294 | 0 | 2,447 | 495 | 205 / 466 |
| Modern | 3,989 | 0 | 0 | admin-1 regions (unchanged) | – | – |

`tools/check-names.mjs` (part of `npm test`) also flags a handful of real names
that the old generator could have produced: Arar, Çorum, Sennar, Galena,
Harar, Saransk, Helena, Harstad. Those are on its list of known real names.

## Ids and saves

Only each province's display name changed. Ids, borders, owners, cities,
nations and sea zones are byte-for-byte the same, and saves store provinces by
index, not by name. `tools/check-names.mjs` checks both: it compares every era
file with the version before step 13, and it restores a save made on the old
map onto the new one. Old saves keep their old names only in past event-feed
lines ("Battle of Senven").

## Tools

```
node tools/name-provinces.mjs [rome medieval ww1 ww2 coldwar]   # rename in data/eras/*.json
node tools/name-provinces.mjs --report                          # count invented names, write nothing
node tools/check-names.mjs                                      # no invented names, unique, saves still load
```

`tools/build-eras.mjs` runs the same naming after building a historical era,
so a rebuild keeps real names. The sources download once into `data/raw/`,
which git ignores.

## Sources and licenses

| Source | Used for | License |
|---|---|---|
| [Natural Earth](https://www.naturalearthdata.com) 1:10m populated places (`ne_10m_populated_places_simple`) | Towns | Public domain |
| Natural Earth 1:10m admin-1 states and provinces | Modern region names | Public domain |
| Natural Earth 1:10m geography regions, rivers and lake centerlines, lakes | Physical features | Public domain |
| [Pleiades](https://pleiades.stoa.org) places and names dumps (`pleiades-places-latest.csv.gz`, `pleiades-names-latest.csv.gz`), downloaded November 2026 | Roman-era Latin and Greek place names | [CC BY 3.0](http://creativecommons.org/licenses/by/3.0/us/), "Copyright © The Contributors" (senior editors Roger Bagnall and Richard Talbert). Numbered releases: https://doi.org/10.5281/zenodo.1193921 |
| [historical-basemaps](https://github.com/aourednik/historical-basemaps) (A. Ourednik) | Borders and country names (unchanged) | GPL-3.0 |
| `RENAMES` and `FOUNDED` in `tools/era-config.mjs`; `MEDIEVAL_NAMES` and `NOT_MEDIEVAL` in `tools/province-names.mjs` | Period spellings and founding dates | Curated for this project from common historical usage |

## Known limits

- **Rule 5 names are modern.** About a third of the Rome and Medieval
  provinces use modern region names or physical features; those are real names
  but not the ones in use at the time. Outside the Roman world (Han China,
  India, the steppe) the Rome era relies on them, because Pleiades covers the
  Mediterranean world best.
- **Medieval town names are mostly modern spellings.** That's right where the
  name hasn't changed (Toledo, Burgos, Salamanca). Elsewhere only the curated
  medieval names above are corrected. A few towns may be slightly too young or
  old for 1200.
- **20th-century renames are curated, not complete.** Rename a missed town by
  adding it to `RENAMES` and rerunning `node tools/name-provinces.mjs`.
