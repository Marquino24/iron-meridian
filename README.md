# Iron Meridian

A browser-based real-time grand strategy game. Vanilla JavaScript (ES modules) and HTML Canvas, with no frameworks and no build step.

**Current scope (step 5):** real-world maps in seven eras, sign-in and closed beta, armies, war and conquest, era resources, city buildings, research, command windows, and computer nations that build, research, recruit, go to war and make peace.

## Run

ES modules don't load from `file://`, so serve the folder over HTTP:

```bash
npm start            # = npx serve -l 3000 .   → http://localhost:3000
# or
npx serve .
# or, with no Node:
python3 -m http.server 3000
```

On localhost the game uses the demo sign-in (no account needed); add `?auth=real` to try the real one. The live site is GitHub Pages: pushing to `main` deploys it (see `docs/SETUP.md`).

Open a specific scenario from the URL: `?era=ww2` (rome, medieval, ww1, ww2, coldwar, modern, fictional), plus `&seed=ABCD-1234` for the fictional world. The URL follows your choice, so reloading keeps it.

Single-file build (all JS and CSS inlined; Google Fonts with a system-font fallback):

```bash
npm run bundle       # → dist/iron-meridian.html (opens straight from disk, no server needed)
                     #   dist/iron-meridian.fragment.html (same, without <html>/<head>/<body>, for hosts that add their own)
```

The multi-file source is the real project. `dist/` is generated output and isn't committed.

Rebuild the era maps from the source datasets (downloads them into `data/raw/` on first run; needs `npm install` for mapshaper, d3-delaunay and polygon-clipping). The output in `data/eras/` is committed, so playing doesn't need this:

```bash
npm install
npm run build:eras          # or: node tools/build-eras.mjs ww2 modern
```

Checks: the fictional generator across 200 seeds, then every era map (province counts, every nation owns land and its capital, exact picking, symmetric adjacency):

```bash
npm test
```

## Sign-in and closed beta

The real game lives at **https://marquino24.github.io/iron-meridian/** (GitHub Pages, `main` branch of `marquino24/iron-meridian`) and requires sign-in through Supabase Auth: Google, Discord, GitHub, Twitch or an email magic link. Everyone who signs in lands in **Pending** until an owner approves them; owners approve, deny or revoke testers in the in-game **Admin** panel.

- `docs/SETUP.md`: going live: the one SQL script to run, what to set in GitHub Pages, owners, email limits, troubleshooting.
- `docs/TESTERS.md`: what testers do to get in.
- `docs/supabase-setup.sql`: the beta table, owner list, grants, triggers and row-level security. Paste it into the Supabase SQL editor once (safe to re-run).
- `js/config.js`: the Supabase project URL, the **publishable** key (public by design) and the **owner email list** (`>>> OWNERS <<<`; keep it the same as the list in the SQL script, which `npm test` checks). Never put secret keys in the repository; `npm test` fails if one appears.

Screen flow: sign-in → beta gate (pending / access not granted) → **main menu** (Single Player, Multiplayer and Sandbox "coming soon", Settings, Admin for the owner, Sign out) → era → nation → game. Every screen has a Back button; the in-game MENU pauses and returns to the main menu with **Resume**.

**Demo sign-in** (a fake approved owner in that browser, with `[Sample]` testers and a DEMO DATA banner in the admin panel) exists only in the claude.ai dev preview (the bundled `dist/` build) and on localhost for development (`?auth=real` tries the real flow there). The real site never shows it: `js/auth.js` decides, and `tools/e2e/pages.test.mjs` checks the site as GitHub Pages serves it.

Who can do what is enforced by the database, not the browser: testers can only create and read their own row, the server fills in their name, email and provider and forces status to pending, and only owners (matched by confirmed email, from any provider) can read every row and change status. `npm run test:policies` runs these rules against a local PostgreSQL; `npm run test:e2e` runs the sign-in flow in a browser against a fake Supabase client.

The game's files are public on GitHub Pages, so the gate controls who can play through the site; it doesn't hide the code or map data itself.

## Armies, war and economy

**Resources.** Each era has its own set:

| Eras | Resources |
|---|---|
| Roman, Medieval | Gold, Grain, Iron, Manpower |
| WWI, WWII | Money, Food, Steel, Oil, Manpower |
| Cold War, Modern, Fictional | Money, Food, Steel, Oil, Electronics, Manpower |

Every province yields daily: money 10 × share and manpower 120 × share (share: land 1, city 3, capital 5; the map has no population data, so population follows the same shares), food 8 × fertility (plains 1.5, forest 1, urban 0.6, mountains 0.5), iron/steel 2 × share (+4 in mountains), oil 8 on an oil deposit, electronics 3 × (share − 1) from cities. Buildings add to that, Roads multiply the province's output, and a nation whose capital is held by an enemy produces at half rate. Oil deposits are about 35 real oil regions (Baku, Ploiești, the Persian Gulf, Texas, Maracaibo, Sumatra…) placed on the province that contains them; the Fictional World gets random ones. Income arrives every game hour; hover or tap the resource bar for the breakdown per resource. Everyone starts with about ten days of income plus a stockpile (300 oil, so nations without oil can still field some tanks). Armies have no upkeep yet.

**Buildings** (cities only, levels I–III; cost ×1 / ×2 / ×3.5 and time ×1 / ×1.5 / ×2 per level; one construction per city at a time, paid up front, refunded if cancelled; a captured city keeps its buildings but loses the construction):

| Building | Effect per level | Era names |
|---|---|---|
| Farm | +20 / 40 / 70 food | Latifundium, Manor Farm, Farms, Agriculture |
| Mine / Factory | +10 / 20 / 35 iron or steel; a Factory also +20 / 40 / 70 money, and from the Cold War +4 / 8 / 14 electronics | Iron Mine, Factory |
| Oil Well | +15 / 30 / 50 oil; WWI on, oil-deposit provinces only (the one building allowed outside cities) | Oil Well, Oil Field |
| Barracks | I: infantry, II: + ranged, III: + mobile units; II and III train 15% / 30% faster | Castra, Barracks, Military Base |
| Port | coastal only; needed for ships, II and III build them faster | Harbor, Port, Naval Base |
| Fortifications | +25% defense per level for whoever defends the province | Walls, Castle Walls, Fortifications |
| Roads | +10% output per level, and 15% / 30% / 45% faster movement through the province | Roman Roads, Roads, Railways, Infrastructure |

Starting buildings: capitals have Barracks II, a Mine/Factory, a Farm and (if coastal) a Port; one other city in three has Barracks I (and a Port if coastal).

**Command windows.** The command bar (bottom centre; a bottom row on phones) opens three windows that float over the map (drag them by the title bar; on phones they're full-screen sheets, one at a time). The game keeps running underneath. Shortcuts: **A** Army, **P** Production, **B** Buildings, **Esc** closes the top one. Map panning by keyboard uses the arrow keys.
- **Army:** totals per unit type, then every army and fleet with location, units by type, HP and status (idle, moving, in battle, embarked, occupying, retreating). Filter and sort; click a row to fly there and select it.
- **Production:** every city with its recruit queue and construction (progress bars). Bulk recruit: pick a unit and a quantity per city, tick cities (Select all / All with Barracks), see the total cost, confirm. Bulk build works the same for buildings. Cities that can't do it are greyed out with the reason (needs Barracks III, not coastal, already building…).
- **Buildings:** cities as rows, buildings as columns, levels as pips. Tap a cell for the next level's effect, cost and time, then upgrade; tick rows to upgrade one building type in all of them.

The city panel keeps quick single-city actions in **Recruit** and **Build** tabs.

**Research** (window **R**). Each era has its own tree (step 10): 29–31 techs across Military, Economy and Infrastructure, with its own shape (which branch reaches a tier IV capstone: Rome's economy and roads, the medieval army, WWII's Blitzkrieg, the Cold War's Nuclear Deterrent, modern Cyber Warfare; every branch in the Fictional World) and 3–5 **★ signature techs** whose effects exist only in that era:
  - *Rome:* Testudo Formation (infantry take 30% less from ranged units), Viae Militares (+40% speed through provinces with Roads), Valetudinaria (healing ×2), Pax Romana (conquered land integrates faster and never revolts).
  - *Medieval:* Feudal Levy (homeland levies sooner, one more unit), Siege Engines (cities fall 40% faster), Concentric Castles (fortifications +50% stronger), Crusading Zeal (war exhaustion −40%).
  - *WWI:* Trench Systems (+25% defense on your own ground), Aerial Reconnaissance (+25% attack on a battle's first day), Chemical Warfare (cuts the enemy's terrain and fort bonus 40%), Strategic Railways (+30% speed at home).
  - *WWII:* Radar (landings on your coast hit 50% weaker), Fleet Carriers (armies at sea keep more defense), Blitzkrieg Doctrine (35% faster through and occupying enemy land).
  - *Cold War:* Airmobile Infantry (rough terrain slows half as much), Air Interdiction (enemies 40% slower in your land), Nuclear Deterrent (attackers need 60% more strength).
  - *Modern:* Precision Strikes (conquered land starts 15% more integrated), Drone Swarms (enemies occupy your homeland 50% slower), AI Research (+20% research speed), Cyber Warfare (enemies earn 20% less money).
  - *Fictional World:* one from each age: Bastion Lines (entrenchment), Siege Doctrine, Lightning War, Doomsday Deterrent, Arterial Roads.

  `docs/TECH.md` lists every era's tree (regenerate with `node tools/print-tech.mjs`); `node tools/check-tech.mjs` (part of `npm test`) checks each signature effect in play.
- **Cost and time:** grow by tier (tier I about 2 real minutes at 1×, tier II 8, tier III 18, tier IV 27) and are scaled so every era's whole tree is the same 17,370 game hours and about the same cost. Paid when the tech starts; cancelling refunds.
- **Computer nations** research by personality: aggressive ones reach for siege engines and blitzkrieg, defensive ones for castles, radar and the deterrent, expansionists for integration techs.
- **Deterrents** (Cold War Nuclear Deterrent, Fictional Doomsday Deterrent) only deter nations that don't have one. When they deterred everyone, wars thinned out in the second year as most nations got one; now holders cancel each other out. `npm run test:sim` (`tools/check-deterrence.mjs`) compares two-year runs with and without the effect.
- **Old saves** (from before step 10) load: researched techs move to the new tech with the same effect (plus its requirements), anything without a match and research in progress are refunded, and the old queue is cleared. The event feed says so.
- **Slots and queue:** one slot to start; the tier I Economy tech (Census and Scribes, Monastic Scriptoria, General Staff Office, Operational Research, Mainframe Computers, Supercomputing, Royal Academy) opens a second and the tier III one (Imperial Bureaucracy, Universities, Research Laboratories, Big Science, Military-Industrial Complex, AI Research, Grand Institutes) a third. Up to 5 techs wait in a queue (a tech can be queued behind its own requirements); the first one that's ready and affordable starts by itself when a slot frees up. The Research button shows a badge while a slot is idle.
- **Effects** (they change the real numbers; the Bonuses tab lists everything active with its source techs):
  - unit levels 2 and 3 per role: +15% / +30% attack, defense and HP. New recruits come at the researched level; existing units upgrade when they rest in a city with Barracks (fleets next to a city with a Port), paying 20% of their price (not men or food) per level;
  - level III of every building needs its tech (each building stops at level II until then), including Barracks III (mobile units) and Port III;
  - production +10–25% per resource and +10% everything; Synthetic Fuel (and its era twins) turns 15% of steel output into oil, so oil-poor nations aren't stuck;
  - movement +10/+10/+15%, defense +10% twice, mobile attack +10%, recruitment 15% faster, construction 20% faster and 20% cheaper.
- **Balance:** at 1×, a medium nation that keeps the queue full while spending half its income elsewhere finishes the whole tree in about 2.3–2.5 real hours (`npm test` runs this per era). Tier I techs take minutes.
- **Feedback:** a toast and an event-feed entry when research completes, with its effects.

**Clock.** 1 real second = 1 game hour at 1×; pause / 1× / 2× / 4×.

**Units.** Each era has four units in the same four roles, rock-paper-scissors style: infantry beats mobile, mobile beats ranged, ranged beats infantry (×1.5 damage, ×0.67 the other way). Ships move only through sea zones.

| Era | Infantry | Mobile | Ranged | Naval |
|---|---|---|---|---|
| Roman | Legion | Cavalry | Archers | Trireme |
| Medieval | Men-at-arms | Knights | Longbowmen | Cog |
| WWI | Infantry | Cavalry | Artillery | Dreadnought |
| WWII | Infantry | Tank | Artillery | Destroyer |
| Cold War | Mech Infantry | Main Battle Tank | Artillery | Frigate |
| Modern / Fictional | Infantry | MBT | Rocket Artillery | Destroyer |

Full stats are in `js/units.js` (attack, defense, HP, speed in km/h, cost in era resources, base build hours). Infantry costs mostly money, food and men; mobile units need iron/steel and (WWI on) oil; ranged units need steel; ships need steel, oil and (Cold War on) electronics.

**Armies.** Every nation starts with a garrison in its capital (bigger nations, bigger garrison) and in up to 12 cities; coastal major powers get a home fleet. The player also gets 1–3 field armies near its borders. Click a counter to open its panel (units with HP, split selected / split in half, merge with armies in the same place, stop), then click a province to march there. The route follows neighbouring provinces (fastest by distance × terrain move cost ÷ the slowest unit's speed) and shows its ETA, also as a preview while you hover. From a coastal province an army can embark into a sea zone and land on another coast: slow (era transport speed, 6 h to board and 6 h to land) and weak if caught at sea (¼ attack, ½ defense).

**Recruiting.** In a city you own, the province panel's Recruit tab lists the era's units with stats, cost and build time (or why the city can't build it). Land units need Barracks and ships a Port (see Buildings). Cost is paid when queued (cancel refunds it); each city trains one unit at a time. Finished units appear there as a new army (units finishing in a row join it); ships appear in the adjacent sea zone. A captured city loses its queue.

**War.** Click any foreign province to see its nation and **Declare war** (with a confirmation). Your armies can't enter a nation's land unless you're at war with it; unclaimed land is open to anyone.
- An army entering enemy (or unclaimed) land with no enemy army there occupies it: 6 h, 12 h for a city, 24 h for a capital (progress ring on the map). Moving on resets it. An army on a longer route stops to take each enemy province it passes, then carries on.
- If enemy armies are there, a battle starts (crossed swords). Every game hour each unit hits a random enemy unit for `8 × attack × matchup ÷ (defense × terrain) × random 0.75–1.25`; terrain (forest 1.25, urban 1.4, mountains 1.6) protects only the defender, and damaged units hit softer. Below 20% strength an army retreats to a safe neighbouring province (or fights on if there's none). The battle ends when one side has no armies left.
- Taking a capital halves that nation's production. A nation that loses its last province is conquered, and its remaining armies disband.
- AI nations don't act yet; their garrisons defend and retreat.

**Feedback.** The event feed (bottom left) lists wars, battles, captures and finished units; click an entry to open its battle report (units fielded and lost on each side) or fly to the place. Clicking crossed swords opens the live report.

`npm test` includes `tools/check-war.mjs`, a headless run of the simulation: the German Reich conquering Czechoslovakia (9 provinces, about 20 game days = 8 real minutes at 1×), Italy landing in Albania by sea, recruitment timing, split/merge, capital loss, and spawning plus pathfinding in every era. `tools/e2e/war.test.mjs` plays the same war through the UI in a browser (desktop and phone), `tools/e2e/research.test.mjs` the research window, and `tools/e2e/windows.test.mjs` drives the other command windows (`ERA=modern NATION="United States"` to try another nation).

## Computer nations (AI)

Every nation you don't play runs `js/ai.js`. Each has a personality: **Aggressive**, **Balanced**, **Defensive** or **Expansionist**. Some are set by era (WWII Germany, Japan and Italy Aggressive, the USSR Expansionist; the Roman and Han empires Expansionist; the Mongols Aggressive…), the rest are drawn at random (seeded by name). The nation panel shows a nation's personality, army strength and current wars.

- **Economy:** farms when food runs short, mines/factories for production, barracks in border cities, a port if coastal, forts on threatened borders (and more often for Defensive nations), roads in the capital. It keeps a reserve and spends the military share of its treasury on the army.
- **Research:** the same trees and queue as yours, in personality order (Aggressive: military first; Expansionist: economy; Defensive: infrastructure).
- **Army:** recruits a mix (half infantry, the rest ranged and mobile where barracks allow, a few ships for coastal major powers) in proportion to its economy, 1.5× when at war. New units top up the local garrison (capital 3, border cities 1–2), the rest form field armies that gather at a border city facing the likeliest target.
- **War:** a nation declares war on a neighbour (or, for major powers, a nation across a shared sea zone) when its army is clearly stronger: 1.4× for Aggressive, 1.8× Balanced, 2.8× Defensive, 1.5× Expansionist, lower when the neighbour holds its former land. The chance is per month (Aggressive 30%, Expansionist 18%, Balanced 8%, Defensive 2%; minor nations 30% of that; the world wars 1.2×, the Cold War 0.6×, Modern 0.4×). At war it attacks enemy provinces next to its land (and its own lost provinces) with whole armies (3+ units, stronger than the defenders), scoring targets by value (capital 6, city 3, province 1, own former land ×2), defence and distance. Damaged armies (under 45%) fall back to a city to heal, threatened cities get the nearest army or new recruits, small armies walk to the biggest one to combine. Expansionist nations also march into unclaimed land.
- **Across the sea:** an enemy it can't reach by land (an island, another continent) gets a landing. Candidate shores are the enemy coastal provinces nearest its own coast, plus any next to land it (or an ally) already holds. Each is scored as a modest prize (capital 2.5, city 2, other land 1) times how weakly it's held, +2 next to a beachhead, minus the sea crossing from home (supply distance). The army needs 30% more strength than the defenders and sails on transports; the nearest idle fleet escorts it. In peacetime it gathers its armies at the port facing an overseas rival. In the Fictional World major powers also count nations two sea zones away as neighbours. `node tools/check-naval.mjs [months] [--runs=N]` puts the German Reich at war with the UK, Japan with the US and Australia, the modern US with Cuba, counts the landings, and breaks every landing order down by target (capital / city / land, beachhead, defence, sea distance).
- **War score** (step 10), per war, from −100 to +100: the other side's homeland you hold (up to ±60, capital 5, city 2, other land 1, against its whole homeland), battles won (±25) and casualties inflicted (±15). It drives peace terms and war exhaustion (a losing score wears a nation down faster).
- **Peace:** a nation that is losing, stuck in a long stalemate or exhausted offers peace; provinces taken in that war that nobody keeps return to their pre-war owner, armies withdraw home, and a 90-day truce follows.
  - *Your peace window* (nation panel or Diplomacy, **Negotiate peace**): the war score and its parts, their exhaustion, and the provinces you may keep, under the same rules as the computer: taken in this war, joined to your old border, never their capital, at most a quarter of their homeland. Each costs war score (its share of their homeland ×1.5); the window shows the chance they accept (war score minus the demand, their exhaustion, their opinion of you, the difficulty). Nothing picked offers a white peace. A refusal means a week before they'll talk again.
  - *A computer nation winning against you* (war score 25+, after a month) **demands land** by the same rules: accept the terms or fight on.
  - Between computer nations the side 20+ ahead on war score keeps its border gains by the same rules.
- **Integration** (step 10): a province taken from another nation starts at 45% integration and gives its new owner that share of its output, rising to 100% in about 105 days (3½ months); Roads (+25% per level), Fortifications (+20% per level) and integration techs speed it up, and taking back your own land restores it at once. The province panel shows the percentage and days left; the map hatches land still settling in, fading as it integrates.
  - *Unrest:* a province under 60% integration with none of its owner's troops in it is restless. You're warned in the event feed ("station troops there or it may revolt"); a week after a warning it has a small daily chance (0.6%) to revolt and rejoin the nation it was taken from (or break away). In headless runs that's 0–2.5 revolts a year against 5–11 conquered provinces held.
- **Keeping wars in check** (step 9, so no one runs away with the map):
  - *Overextension:* conquered provinces start at 45% integration (above).
  - *Dangerous expansion:* every capture lowers the conqueror's standing with its neighbours and the victim's allies (2.5 a province, 4 a city, 8 a capital; stacks to −50; fades over two years). It shows in the opinion breakdown.
  - *Coalitions:* a nation that fears a bigger neighbour (opinion −20 or worse, the neighbour 1.25× its size and at least 8% of the map) joins that neighbour's wars on the victim's side when together they stand a chance ("X joins the coalition against Y"). When the victim is down to half its homeland, mere dislike (opinion 0 or below) is enough. This applies to you too.
  - *War exhaustion:* a year of war counts 1, losing the army you had 1.5 more; at 1 a nation sues for peace, at 0.8 it accepts one even while winning. A nation that two or more neighbours fear starts fewer wars and settles after 45 days.
  - *Homeland levies:* a nation at war that has lost a fifth of its home provinces raises free infantry in a city it still holds every two game days (two units past 40%). You get them too.
- **Healing:** armies resting on their own land recover 3% of their strength per hour in a city, 1% elsewhere.

**Fictional World:** nations differ. By size (with some luck either way) each is a **Great power** (starting armies 1.35×, economy 1.15×, usually Aggressive or Expansionist), a **Regional power** (1.1×, any temperament) or a **Minor state** (0.85×, economy 0.9×, Balanced or Defensive, and it rarely starts wars). Wars start twice as often as the base rate, and a nation long at peace grows restless: the edge it wants over a neighbour shrinks by up to a quarter after a year of peace, so evenly matched worlds still see war (unseeded, about 4% of year-long runs end with no war, down from 13%). The nation list shows it. Before this every fictional nation was a near-identical major power, nobody had the edge the AI waits for, and no war ever started; now wars break out on almost every seed (`node tools/check-fictional.mjs`, part of `npm test`, with seeded dice so it gives the same answer every run).

**Balance report:** `npm run balance` (`tools/balance.mjs [fictional|history|all] [--runs=3] [--check]`) runs the Fictional World on 12 seeds for a year (three seeded runs each) and every historical era for six months, and reports the largest share of the map, wars (new ones apart from allies and coalitions joining), peace deals and conquests. Targets (step 10): under about 30% in the Fictional World after a year, 4–16 new wars and at most 15% in each historical era.

**Difficulty** (nation screen): **Easy** AIs think 1.6× less often, start half as many wars, need a bigger edge and produce 10% less; **Hard** AIs think more often, pick the weakest-defended high-value targets, attack only with a clear edge, and produce 15% more.

**Feedback:** an AI declaring war on you pauses the game with a full alert; other nations' wars appear in the event feed and as dashed red lines between capitals when zoomed out (toggle with **⚔ Wars** next to the map styles).

**Performance:** nations think on a staggered schedule (major powers every 12 game hours, nations of 25+ provinces daily, 6+ every two days, the smallest every three), each think is split into small steps, and every frame works through the due ones until a time budget runs out (3 ms, shrinking to 0.5 ms and every third frame on a struggling device). The economy updates incrementally (a conquered province moves its cached yield to the new owner) and path searches use A*.

`npm run sim:ai` (`tools/sim-ai.mjs [months] [easy|normal|hard] [era…]`) runs every nation headless for six months and reports growth, wars, peace deals, conquests and the largest share of the map anyone reached.

**Economic weight.** Provinces were cut roughly by land area, so counting them made colonial empires and Siberia huge and compact industrial powers small (WWII Germany earned 410 a day against France's 1,930). `js/development.js` now gives every province a development value: colonies and far frontiers (more than 1,500 km from the capital and not linked to it by land within 4,500 km) produce 0.35×, polar land 0.35×, other nations scale with the square root of their size, and each era's major powers are scaled to their real GDP and population (Maddison-style estimates). The value stays with the province when it's conquered. The 20th-century maps were also rebuilt with each major power's real cities (`majorCities` in `tools/era-config.mjs`; WWII Germany went from 2 cities to 15). `node tools/print-economies.mjs` lists the largest economies per era.

## Diplomacy

Between any two nations: **War**, **Peace**, or treaties on top of peace — **Non-Aggression Pact**, **Right of Passage** (armies may cross the other's land) and **Alliance** (includes both). Every peace leaves a 90-day truce.

- **Opinion:** every nation has an opinion of every other, −100 to +100, with its reasons shown (hover a row, or open a nation in the Diplomacy window): our ally, historical ties (the era's real alignments: Axis/Allies, Entente/Central Powers, NATO/Warsaw Pact…), common threat, shared enemy, at war / recent war, took our provinces, border tension with a stronger neighbour, temperament, and memories that fade over time — gifts (a year), trade, joining our war, refusing to, cancelling a treaty, and **breaking one** (attacking during a pact, alliance, passage or truce: −60 with the victim for three years, −25 with everyone else for two).
- **Alliances:** when a nation is attacked, all its allies join the war automatically (you too — an alert says so). Allies can be asked to join offensive wars; they weigh their opinion of you, of the target, and the odds. When the two sides make peace, allies who joined over it follow. Alliance blocs are outlined on the map, one colour per bloc.
- **Trade and gifts:** offer any swap (e.g. 500 steel for 300 oil); the other side values each resource by how short of it they are and by their opinion of you, and the window previews their answer. Gifts raise opinion in proportion to their size next to the receiver's income.
- **The AI** forms alliances (with friends who share an enemy or a threat — e.g. "German Reich and Kingdom of Italy formed an alliance"), signs pacts with strong neighbours, ditches allies it has come to dislike, chooses war targets by opinion (pacts hold except for an enraged aggressor), calls its allies in, and makes **proposals to you** — a treaty, a trade, or joining its war — as popups with Accept / Decline (at most one every 10 days).
- **Diplomacy window (D):** every nation you've met (neighbours, major powers, and anyone you've traded, fought or signed with), filterable and sortable by opinion, power and relation, with buttons to propose or cancel each treaty, ask an ally into a war, trade, send a gift, declare war (with a warning when it breaks a treaty) or offer peace.

## Win conditions

Chosen on the nation screen, after difficulty:

- **Victory Points** (default): every city is worth 1 point and every capital 3 (yours or one you took). The first nation to **10% of all the points on the map** wins (WWII: 53 of 524; the target scales with each era's map).
- **Domination:** control 40% of the world's provinces.
- **Off:** play without one (no score widget). The sandbox always plays without one.
- **Time limit** (optional, 5–50 years): when it runs out, the leader in points wins.
- **Defeat:** you hold no city at all, or another nation reaches the goal first.

The top bar shows your points against the top three (tap for the full leaderboard). How long a win takes: in headless runs at Normal, with one computer nation set to an all-out conquest personality as a stand-in for an aggressive player, someone reached the Victory Points target after 7–9 game years (Modern: the stand-in China after 6.9 years; WWII: the Soviet Union, an ordinary computer nation, after 8.8 years, with the stand-in Germany stalled at 46 of 53). That is 17–21 hours at 1×, since one game year is about 2.4 real hours. In WWI and the Cold War nobody reached it within 10 years, because defensive alliances stop runaway conquest. Most games will be played at 4–8× or with a time limit.

The end screen shows victory or defeat, your provinces over time, battles won and lost, units built, nations conquered, game time and time played, with **Main Menu** and **Keep Playing**.

## Flags

Every nation shows its real flag for the era's date wherever one exists — nation select, top bar, nation panel, war and peace alerts, battle reports, and a small flag on each army marker:

- **Modern:** [flag-icons](https://github.com/lipis/flag-icons) 7.6.0 by Panayiotis Lipiridis, MIT licence.
- **WWI (1914), WWII (1939), Cold War (1960):** the flags in use that year from Wikimedia Commons (USSR hammer and sickle, East and West Germany, Kingdom of Italy, Austria-Hungary, Ottoman Empire, Qing-era five-colour flag of the Republic of China, 48/49-star US flags, Red Ensigns of Canada…), or today's flag from flag-icons where the design was the same then. Minor colonies and protectorates fly their sovereign's flag; major colonies fly their own colonial flag (below). Licences per file: [docs/FLAGS.md](docs/FLAGS.md).
- **WWII Germany** flies the black-white-red tricolour (the national flag 1933–35) instead of the swastika flag, which is illegal to display in Germany and avoided by commercial WWII games.
- **Roman and Medieval:** no national flags existed, so major powers carry banners: a Roman vexillum with SPQR, a Han banner, and medieval banners of arms (France's fleurs-de-lis, England's three lions, the imperial eagle, Castile, León, Aragon, Portugal, Scotland, Hungary, Venice, Burgundy, the Papal keys; Denmark's Dannebrog).
- **Colonial flags:** where a major colony had its own flag, it flies it instead of the ruler's. British India (part of the United Kingdom on the 1914 and 1938 maps) flies the Star of India ensign, and the Belgian Congo its blue flag with a gold star. Their provinces show it in the province panel (with a **Colony** row), as do the sovereign's garrisons there and armies raised there. Laos, part of French Indochina in 1938, flies the Indochina flag. These three flags are drawn for the game (`tools/flag-custom.mjs`; the Star of India badge is simplified, without its motto), because Wikimedia was refusing downloads when they were added. The colony boxes are in `js/colonies.js`. Colonies whose flags carry intricate badges (Ceylon, Fiji, the British African colonies) keep the ruler's flag for now.
- **Everyone else** (no known flag or banner for the date) gets a generated coat of arms on a heater shield over a dark ground, following the heralds' rule of tincture — clearly arms, not a flag.

Flags are rendered into one small WebP sheet per era (`assets/flags-<era>.webp`, 180×120 tiles). Rebuild with `python3 tools/fetch-commons-flags.py && node tools/build-flags.mjs`; sources per nation are in `tools/flag-sources.mjs`, and the counts per era in docs/FLAGS.md.

## Saved games

- **Slots:** eight save slots plus an **autosave** every in-game week (Ctrl/Cmd+S saves to the autosave slot at any time). In a game, **MENU** pauses and shows **Save Game** and **Load Game**; the main menu has **Continue** (the newest save, autosave included) and **Load Game**.
- **Load screen:** each slot shows a map thumbnail around your land with your flag, the nation, the in-game date, era, difficulty, day, provinces and points, and when it was saved. Sandbox saves are marked **Sandbox** and load as sandbox games. Overwriting and deleting ask for a second click. A loaded game starts paused.
- **What a save holds:** the map itself is rebuilt from the era data (or the fictional seed), so a save only holds what changed: province owners, the clock, every nation's stockpiles, buildings and construction, armies (units, HP, levels, marching orders, positions mid-march), recruitment queues, battles under way, wars, truces, occupations, research, the AI's brains, treaties, opinions and their memories, win conditions and stats, the event feed, and the sandbox switches. It's JSON, gzip-compressed with the browser's CompressionStream (WWII mid-war: 225 KB → 24 KB; Modern 39 KB), stored in IndexedDB.
- **Moving saves between devices:** **Export** (on any slot, or "This game" on the save screen) writes a `.json` file (a readable header plus the compressed game). **Import file** on the load screen reads it into a free slot. In the claude.ai preview the export goes through claude.ai's download prompt.
- **If storage is blocked** (some private windows and embeds), saves last until the page closes and the load screen says so: export to keep them.
- **Checks:** `node tools/check-save.mjs [era]` (part of `npm test`) plays a war headless, saves, loads into a fresh game, checks that it saves back byte for byte, then runs both games 30 days on with the same dice and checks they stay identical. It also loads a version-1 save (old tech tree) and checks the migration. `tools/e2e/save.test.mjs` does the same through the UI mid-war: save from the pause menu, play on, load, compare everything; Continue after a page reload; export, delete, import; the weekly autosave; sandbox saves.

## Sandbox

**Sandbox** on the main menu starts the same way (era → nation), then adds a toolbar on the left (a strip above the command bar on phones). The top bar shows a purple **SANDBOX** tag and a striped edge throughout, so it is never mistaken for a normal game. Tools:

| Tool | What it does |
|---|---|
| Paint | Pick a nation, then tap or drag over provinces to give them to it (pinch or scroll still moves the map) |
| Armies | Pick a nation, unit type and amount (1–50), then tap a province — ships go on the sea or a coast |
| Resources | Give or take any amount of any resource for any nation; "+ everything" and "Empty all" |
| Diplomacy | War or peace between any two nations; sandbox peace keeps today's borders, leaves no truce, and war ignores truces |
| AI | All computer players on/off, or one nation at a time |
| Instant | Instant build, recruit and research for the nation you play (costs still paid; works while paused) |
| Play as | Switch to any nation at any time; the computer takes over the one you leave |

Every nation picker has a target button to pick a nation by tapping the map (on phones the panel folds out of the way; the ▾ button folds it by hand too). Time goes up to 16×. Starting a normal game afterwards clears all of it.

## Multiplayer (in progress: owners only)

Persistent games in the style of Conflict of Nations are being built. The architecture decision, with the measured numbers and the Supabase free-tier limits, is in `docs/MULTIPLAYER.md`.

**Chosen design.** Supabase Edge Functions run the world on a schedule: each tick loads the game, applies orders and saves it. Clients predict between ticks.

**Built so far (step 11A):**
- **Tables:** `docs/supabase-multiplayer.sql`, to run in the Supabase SQL editor after `docs/supabase-setup.sql`. It creates games, players, saved state and orders, with row-level security. `npm run test:policies` tests the policies.
- **Commands:** every order a player gives goes through `js/commands.js` as a JSON command record, in single-player too. `node tools/check-commands.mjs` is part of `npm test`.
- **Lobby:** create, list, join (pick a nation) and leave games. It's behind `MULTIPLAYER_PREVIEW` in `js/config.js`:
  - `'owners'` (now): only owners see it; everyone else keeps "Multiplayer · Coming soon";
  - `'off'`: nobody sees it;
  - `'everyone'`: approved testers see it too.

  The claude.ai preview and localhost use an in-browser demo lobby with sample games. `tools/e2e/lobby.test.mjs` tests it.

Games can't be played yet: the game server comes next.

## Phones, tablets and Safari

- **Safe areas:** the page uses `viewport-fit=cover`, and the top bar, status bar, resource strip, command bar and side panels keep their content out of the notch / Dynamic Island, the home bar and (in landscape) the side notches.
- **Touch:** on touch screens every control is at least 44 px (Apple's minimum) and no text is smaller than 11 px; table checkboxes are tappable through their whole cell. One finger pans, two fingers pinch, holding two fingers still for half a second starts a selection box between them.
- **Layouts:** phones in portrait get the resources in a strip under the top bar, a bottom command bar and full-screen windows. Tablets in portrait and phones in landscape (761–1100 px) also move the resources to a strip and compact the score and clock, so MENU never falls off the edge. Up to 900 px on touch screens the speed buttons become two: pause, and one that cycles 1×, 2×, 4×. Windows always open between the top bar and the command bar.
- **Graphics:** Auto picks Low on phones and Medium on tablets, and steps down by itself if frames are slow.
- **Test:** `npm run test:devices` (`tools/e2e/devices.test.mjs`) runs Chromium and WebKit (Safari's engine; needs `npx playwright-core install webkit` and its system libraries) at iPhone 390×844 and iPad 820×1180, portrait and landscape. It covers the sign-in and Pending screens, menus, the game HUD, every window opening, fitting and closing, overflow, tap and text sizes, touch pan, pinch and two-finger box select, the safe areas (simulated notch and home bar) and the frame rate.

## Map styles and settings

- **Political:** vivid nation colours with terrain symbols, a soft glow along borders, your nation outlined in glowing gold, and a blue ocean with wave crests. Roman and Medieval eras draw it as an old parchment map.
- **Satellite:** NASA Blue Marble (topography and bathymetry, August 2004) reprojected to the game's Miller projection, with extra relief shading, semi-transparent nation colours and crisp borders on top.
- **Terrain:** Natural Earth II land cover with shaded relief and thin nation borders.
- **Clouds** (satellite only, toggle on the style bar): soft clouds with ground shadows that thin out as you zoom in. The menus fly over the satellite map with clouds.

Switch styles with the big Political / Satellite / Terrain buttons (top right, always on screen); the default is in **Settings**, along with graphics quality, UI scale and sound volume.

Graphics quality sets the effects (everything is drawn in code; there are no image files besides the two map rasters):

| | Low (phones) | Medium (tablets) | High (desktop) |
|---|---|---|---|
| Wave crests on the ocean | — | moving, ~12 fps | moving, ~30 fps |
| Clouds | still (baked into the map) | still, with shadows | drifting, with shadows |
| Battle sparks and explosions | still badge | animated | animated |
| Border glow, gold glow on your nation, terrain symbols | — | yes | yes |
| Resolution cap | 1× | 1.5× | 2× |

On Auto the game steps down one level (High → Medium → Low) for the session if frames stay under ~45 fps while you pan or the clock runs. UI scale and sound volume (saved for later; there's no sound yet). Rebuild the imagery with `python3 tools/build-imagery.py` (needs Pillow and NumPy; downloads are described in the script).

## Controls

| Input | Action |
|---|---|
| Drag (mouse / one finger) | Pan, with inertia |
| Scroll wheel / pinch / trackpad pinch | Zoom toward the cursor |
| Arrow keys, `+` / `-` | Pan / zoom |
| Click a province | Inspect it (on the start screen, clicking picks that nation) |
| Click an army marker | Select it; then click a province or sea zone to move, or an enemy marker to attack it |
| Shift + drag (desktop) / hold two fingers still, then spread them (phone, tablet) | Box selection: picks every army of yours inside; the next click moves them all (bar at the bottom: Halt / Clear) |
| Click a merged badge (zoomed out) | Zooms in to split it; your own badge also selects those armies |
| Click crossed swords / a feed entry | Battle report |
| A / P / B / R | Army / Production / Buildings / Research window |
| Esc | Close the top window, else deselect (army first, then province) |
| Space | Pause / resume the clock |

## File structure

```
index.html        Page shell: canvas + HUD markup (top bar, panel, status bar, start screen)
styles.css        HUD theme with era palettes (body[data-theme]), responsive layout
package.json      npm start / npm test
data/eras/        Prebuilt era maps (one JSON per era, ~0.6–1.4 MB each; gzip ~0.2–0.4 MB)
assets/           satellite.webp, terrain.webp (4096×2051, Miller projection)
tools/
  build-eras.mjs  Real borders → playable era maps (see "Era data" below)
  era-config.mjs  Per-era sovereignty fixes, names, major powers, capitals, city lists
  check-map.mjs   Fictional generator checks across many seeds
  check-eras.mjs  Era map checks
  build-imagery.py  Reprojects Blue Marble and Natural Earth rasters into assets/
  bundle.mjs      Inlines everything (code, CSS, gzip'd era data, imagery) into one HTML file (dist/)
  check-commands.mjs, check-tech.mjs, check-zero-wars.mjs (part of npm test); check-deterrence.mjs (npm run test:sim)
  spike/          Step 11A measurement of a server tick (server-tick.mjs) and its Edge Function packager
docs/             SETUP.md (going live), TESTERS.md, supabase-setup.sql and supabase-multiplayer.sql (paste into Supabase),
                  MULTIPLAYER.md (architecture decision), FLAGS.md, TECH.md
supabase/
  test/           Policy tests for docs/supabase-setup.sql and supabase-multiplayer.sql on plain PostgreSQL with a mock auth schema
  functions/tick-spike/  Deployable Edge Function version of the tick measurement (not used by the game)
vendor/           @supabase/supabase-js 2.117.3 (UMD, MIT), loaded only when sign-in is on
privacy.html, terms.html   Linked from the sign-in screen and provider consent screens
js/
  config.js       Supabase URL + publishable key, provider list, multiplayer preview switch
  auth.js         Supabase client wrapper: sign-in, beta row, realtime, admin queries
  launcher.js     Sign-in screen (incl. preview demo sign-in), beta gate screens, admin panel
  menu.js         Main menu, era/nation/settings screens, Back navigation
  settings.js     Saved settings and device-based quality defaults
  assets.js       Loads map imagery on demand
  brand-icons.js  Provider logos (simple-icons, CC0)
  main.js         Bootstrap + game loop; era loading; camera framing; `systems` hook
  eras.js         Era list (labels, start dates) and era data loading
  world.js        Decodes an era file into the runtime map (same shape as map.js output)
  projection.js   Miller projection, lat/lon formatting, graticule (shared with the build)
  map.js          Fictional world generation (no DOM): seeded RNG, noise, Voronoi,
                  land/terrain, nations, cities, names, borders, picking
  state.js        GameState + event emitter: the single source of truth;
                  all mutations go through methods that emit events
  render.js       Canvas renderer: cached static layer, level of detail, culling,
                  chunked borders, terrain patterns, labels without overlaps; drawFlag()
  camera.js       Camera (smooth zoom, inertia, fly-to, clamping) and
                  InputController (pointer events, pinch, wheel, keys)
  ui.js           DOM HUD: start screen, top bar/clock, province panel, status bar
  units.js        Era rosters (unit stats) and the rock-paper-scissors matchups
  economy.js      Era resources per nation: stockpiles, daily income with breakdown, capital-lost penalty
  armies.js       Armies and fleets: spawning, land+sea movement graph, pathfinding,
                  marching, split/merge, recruitment queues
  combat.js       Wars, hourly battles, retreats, occupation, capture, conquest
  render-units.js Army markers (era unit icon, nation ring, count, HP bar), merged badges when zoomed out,
                  route arrows with ETA, animated battle clash, occupation rings, box selection, hit testing
  render-fx.js    Ocean, wave crests, clouds, city and capital badges (cached sprites)
  icons.js        Every icon as SVG paths: resources, units per era, buildings, HUD (inline SVG + canvas)
  palette.js      Vivid nation colours from the era data's muted ones
  flags.js        Real flags from the era sheet, heraldic shields otherwise (repaints when a sheet arrives)
  flag-index.js   GENERATED: nation → tile per era (tools/build-flags.mjs)
  diplomacy.js    Relations, treaties, opinion with reasons, alliances and call-to-arms, trade and gifts, proposals
  win-diplomacy.js  Diplomacy window (D)
  victory.js      Win conditions, points, defeat, end-of-game stats
  victory-ui.js   Win-condition picker, score widget, leaderboard, end screen
  sandbox.js      Sandbox rules: paint, spawn, resources, war/peace, AI switches, instant modes, play as
  sandbox-ui.js   Sandbox toolbar and panels, nation pickers with pick-on-map
  command-ui.js   Money/manpower bar, army panel, recruit/war sections of the province panel
  feed.js         Event feed and battle report popup
  resources.js    Era resource sets, province yields, oil deposits
  buildings.js    City buildings: levels, effects, construction queue, era names
  ui-kit.js       Shared HUD helpers (number/time formatting, cost chips)
  windows.js      Command bar and window manager (drag, z-order, phone sheets, shortcuts)
  win-army.js     Army window
  win-production.js  Production and Buildings windows (bulk recruit / build)
  tech.js         Era tech trees (one per era, signature effects, costs per tier, old-save mapping)
  research.js     Research per nation: slots, progress, effect queries used by the other systems,
                  migration of pre-step-10 research
  win-research.js Research window (tree view with requirement lines, details)
  development.js  Province development: real economic weight per era, colonies, polar land
  ai.js           Computer nations: personalities, difficulty, staggered thinking, landings,
                  coalitions, war exhaustion
  diplomacy-ui.js War alerts, peace offers and AI land demands
  peace-ui.js     Peace window: war score, provinces to keep, acceptance chance
  commands.js     Player orders as JSON command records: checked and applied in one place
  lobby.js        Multiplayer lobby data: Supabase tables, or a demo lobby in this browser
  lobby-ui.js     Multiplayer lobby screen (owners only for now)
  integration.js  Conquered land settling in (45% → 100%), unrest and revolts
  save.js         Saved games: snapshot/restore of every system, gzip, IndexedDB slots, export files
  save-ui.js      Continue, save/load screen with thumbnails, weekly autosave, export/import
  colonies.js     Major colonies inside their sovereign (British India, Belgian Congo) and their flags
```

## Data model (from `generateMap(seed)`)

- `provinces[]`: `id, name, center, site, polygon, area, neighbors[] (land), seaNeighbors[], coastal, terrain, isCity, isCapital, owner, landmass, elevation`
- `nations[]`: `id, name, shortName, color, flag {pattern, colors}, capitalId`
- `seaZones[]`: `id, center, polygon, neighbors[], coastalProvinces[]` (ready for naval movement)
- `borders[]`: shared edge segments (`land` province↔province, `coast` province↔sea)
- `TERRAIN`: per-terrain `moveCost` (already used for territory growth) and `defense` (a placeholder for combat)

## Extending in later steps

- **Simulation systems** (AI next): add an object with `update(state, gameHours)` to `systems` in `main.js`, next to the economy, armies and combat. It runs every frame with the in-game hours elapsed (0 while paused). An AI can use the same calls the UI does: `armies.order()`, `armies.recruit()`, `combat.declareWar()`.
- **State changes:** add methods to `GameState` that mutate data and `emit` an event. `setOwner()` is the template: the renderer rebuilds borders and colours on `province:owner`, and the panel re-renders.
- **New map layers** (fronts, supply lines): draw them in `Renderer.render()` between the province layer and the screen-space overlay, as `render-units.js` does. Call `renderer.requestRender()` whenever they change.

## Era data

| Era | Source | Data year used | License |
|---|---|---|---|
| Roman Empire (AD 117) | [historical-basemaps](https://github.com/aourednik/historical-basemaps) | 100 (no 117 file exists) | GPL-3.0 |
| Medieval (1200) | historical-basemaps | 1200 | GPL-3.0 |
| World War I (1914) | historical-basemaps | 1914 | GPL-3.0 |
| World War II (1939) | historical-basemaps | 1938 (no 1939 file exists) | GPL-3.0 |
| Cold War (1960) | historical-basemaps | 1960 | GPL-3.0 |
| Modern | [Natural Earth](https://www.naturalearthdata.com) 1:10m admin-1 regions (states, provinces) and 1:50m countries | current release | Public domain |
| City points for 20th-century eras and Modern | Natural Earth 1:50m populated places | — | Public domain |
| Satellite imagery | [NASA Blue Marble Next Generation](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/) | August 2004 | Public domain |
| Terrain imagery and relief | Natural Earth II and shaded relief, 1:50m rasters | — | Public domain |

How a map is built (`tools/build-eras.mjs`):

1. **Sovereignty:** each feature is grouped under its ruler (historical-basemaps `SUBJECTO`, Natural Earth `SOVEREIGNT`), so colonies belong to their empire (British Raj → United Kingdom in 1914). A few manual fixes are in `era-config.mjs` (`aliases`), for example the German colonies in 1914. Features that name a people or culture rather than a state ("Khoisan", "Paleo-Siberian hunter-gatherers") become unclaimed land that keeps the name as a region label.
2. **Geometry:** mapshaper cleans, dissolves by ruler, simplifies to 12% and clips to 58°S–84°N (Antarctica cut). Then the Miller projection is applied.
3. **Provinces (historical eras, ~3,600 each):** each country gets seeds in proportion to area^0.68 (unclaimed land at 30% weight), with a minimum of one, and every sizeable island gets its own. Real cities are fixed seeds, so every city sits in its own province. The Voronoi cells are clipped to the country's real outline.
   **Provinces (modern, ~4,000):** real admin-1 regions with their names. Countries the dataset splits very finely (the UK's local authorities, Slovenia's municipalities…) use the dataset's own region grouping when that's closer to their province budget; regions too small to click merge into the nearest region of the same country; very large ones (Siberian oblasts, Australian states, Canadian territories) are split into seeded parts named by direction ("Krasnoyarsk Krai North").
4. **Adjacency:** every province edge records what lies across it: another province, or a sea zone (Voronoi cells of ocean sample points, kept for naval units).
5. **Terrain:** mountains come from about 35 real ranges, forests from climate bands, and cities are often urban.

The GPL-3.0 license of historical-basemaps applies to the generated files in `data/eras/` (except `modern.json`) and to the single-file build that embeds them. Keep the attribution, which the start screen also shows.
