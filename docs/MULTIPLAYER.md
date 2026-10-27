# Multiplayer architecture (step 11A)

Goal: persistent games in the style of Conflict of Nations. Up to 10–20 human players per map, computer nations fill the rest, and the game keeps running when everyone is offline. It runs slowly, configurable per game; the default is 1 game day per 4 real minutes. Constraint: no paid server. The tools are Supabase on the Free plan (Postgres, Auth, Realtime, Edge Functions, pg_cron) and GitHub Pages.

## Recommendation

Use a **server-authoritative tick on a Supabase Edge Function** (option a), run with the hybrid details in option c.

- **Scheduled ticks:** pg_cron calls the tick function **every 5 minutes for each running game**. Each call loads the saved state, applies the pending commands, advances the world about 30 game hours, and saves the state.
- **On-demand ticks:** when a player sends an order, the client also asks for an immediate tick, rate-limited per game. Orders then take effect within seconds instead of up to 5 minutes.
- **Client prediction:** the browser runs the same simulation from the last saved state, so armies move smoothly between ticks. It corrects itself to each new authoritative state.

It fits the free tier. Ticks take **0.2–0.6 s** of the 2 s CPU limit on Deno, the Edge Function runtime. Even Node's more pessimistic count stays **under 1.2 s**. That leaves room for **about 45–55 concurrent games**. The binding limit is the 500,000 invocations a month, not CPU.

## What was measured

The spike is `tools/spike/server-tick.mjs`. It runs under Node 22 and Deno 2.1.4; Supabase Edge Functions run on Deno. The same code is also packaged as a deployable Edge Function, `supabase/functions/tick-spike/` (see "Verify on Supabase" below).

**Machine:** Intel Xeon @ 2.10 GHz, one core per run. The test states are full-size maps after 90–180 days of all-computer play:

| State | Size |
|---|---|
| WWII | 3,616 provinces, 113 nations, 380–420 armies |
| Modern | 3,989 provinces, 200 nations, 610 armies |

"Busy" states had 20 extra wars declared a month in. A saved state is **26–48 KB** gzip'd (277–508 KB of JSON).

One tick = build the game on the map data, restore the save, advance N game hours, save.

| Tick on the busy Modern map | Deno (Edge runtime) | Node (process CPU, incl. GC/JIT threads) |
|---|---|---|
| Fixed cost: build map + restore + save | 110–200 ms | 250–550 ms |
| Simulate 1 game hour: median / p95 / max (a game week, hour by hour) | 7 / 14 / 39 ms | 9 / 32 / 57 ms |
| Simulate 1 game day | 150–240 ms | 160–475 ms |
| Whole tick, 24 game h | 380–410 ms | 610–690 ms |
| Whole tick, 30 game h (served as an Edge Function locally) | 542 ms | — |
| Whole tick, 48 / 96 game h (Edge Function locally) | 641 / 837 ms | — |
| Memory | 60 MB JS heap, 160 MB process | 150–250 MB process |

The WWII map is cheaper: a whole 24 h tick takes 230–270 ms on Deno and 380–820 ms on Node.

**Why the two runtimes differ:** Deno has no `process.cpuUsage()`, so its figures are wall time of single-threaded synchronous work. That is close to the main-thread CPU an Edge Function is charged. Node's figures add its background GC and JIT threads, so read them as an upper bound.

## Free-tier limits checked

| Limit | Free plan | Source |
|---|---|---|
| Edge Function CPU time per request | **2 s** (excludes async I/O) | [Edge Function limits](https://supabase.com/docs/guides/functions/limits) |
| Edge Function wall clock / idle timeout | 150 s / 150 s | same |
| Edge Function memory | 256 MB | same |
| Edge Function size | 20 MB (CLI bundle) | same |
| Edge Function invocations | **500,000 / month** | [Pricing](https://supabase.com/pricing) |
| Database size | 500 MB | same |
| Egress | **5 GB / month** | same |
| Realtime | 200 concurrent connections, 2 M messages / month, 256 KB per message | same |
| Inactivity | **free projects pause after 1 week without activity** | same |
| Compute | Nano: shared CPU, 0.5 GB RAM, ~60 connections | [Compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk) |
| Cron | every second to once a year; ≤ 8 jobs at once and ≤ 10 min per job recommended; calls Edge Functions with pg_net, key in Vault | [Cron](https://supabase.com/docs/guides/cron), [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) |
| GitHub Actions as a free worker | **not allowed**: "don't use Actions … as part of a serverless application", nor for activity unrelated to the project's software | [GitHub terms for Actions](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features) |

## Options compared

### a) Server-authoritative: pg_cron → Edge Function

**CPU.** At the default speed (1 game day = 4 real min) a game advances 6 game hours per real minute.

| Tick every | Game hours per tick | Deno CPU per tick | Node CPU per tick | Fits 2 s? | Invocations per game per month | Games at 500k / month |
|---|---|---|---|---|---|---|
| 1 min | 6 | ~0.2–0.3 s | ~0.4–0.7 s | yes | 43,200 | **~11** |
| 5 min | 30 | ~0.3–0.55 s | ~0.6–1.2 s | yes, 1.7–3.5× headroom | 8,640 | **~57** (≈45–50 with on-demand ticks) |
| 10 min | 60 | ~0.6–0.9 s | ~1.2–2.0 s | risky on Node numbers | 4,320 | ~115 |

Slower game speeds (10 or 30 min per game day) make each tick cheaper. They need the same number of invocations.

| Resource | Use at 50 games | Verdict |
|---|---|---|
| Memory | one game at a time, ~60 MB heap | fits |
| Database | ~35–65 KB of base64 state per game: ~3 MB | trivial; commands must be pruned |
| Writes | ~600 per hour | trivial |
| Egress | ~0.7 MB per active player-hour if each client fetches every new state (12 / hour × ~60 KB) | 5 GB covers **~7,000 active player-hours a month** (~230 a day). Fetch only while the tab is visible; send deltas later if needed. |
| Realtime | one tiny "new tick" message per tick per client | 200 concurrent connections = **200 players online at once** |

- **Cheating:** none possible against the server. Clients only send commands, and the same `js/commands.js` checks them on the server.
- **Risks:**
  - Supabase's own CPU speed is unknown. These numbers are from a 2.1 GHz Xeon; verify with the deployable spike.
  - A free project pauses after a week without activity, and cron may not count as activity. Games would then freeze until it is resumed in the dashboard.
  - A tick that overruns 2 s is killed. Keep each tick to at most about 30–48 game hours, and catch up in chunks.

### b) Host-authoritative: one player's browser runs the game

The host's browser simulates the game; the others receive state and commands through Realtime.

- **Server cost:** none.
- **Capacity:** limited only by Realtime, 200 connections, so about 10 full 20-player games online at once.
- **Fails the offline requirement.** When the host closes the tab the world stops. It can catch up when someone next opens it: 8 hours offline at the default speed is 120 game days, about 12–30 s of simulation on a desktop and 2–5× longer on a phone. Until then nothing happens, and "the war went on while you slept" is only true in hindsight.
- **Host migration** is needed when the host leaves mid-session.
- **Cheating:** the host owns the state. Anyone hosting can change any number in devtools, and the others can't tell. Every client also holds every nation's full state.

### c) Hybrid (recommended): a) plus on-demand ticks and client prediction

This is option a, plus two things that hide the 5-minute tick:

1. **On-demand ticks.** After sending an order, the client calls the tick function for that game. The server enforces at most one extra tick per game per 30 s. Orders apply within seconds while players are online. When they are offline, cron alone keeps the world moving.
2. **Client prediction.** The client runs the simulation locally from the last authoritative state for smooth movement, then replaces its state with each new authoritative one. Battles can come out differently in a prediction and snap to the server's result, because the simulation's dice aren't seeded per tick yet. A later step can make the dice deterministic. Then predictions match the server exactly, and clients could download commands instead of whole states, cutting egress to almost nothing.

| | a) cron Edge Function | b) host browser | c) hybrid |
|---|---|---|---|
| Runs with everyone offline | yes | no (catch-up on return) | yes |
| Order latency | ≤ 5 min | instant | seconds online, ≤ 5 min offline |
| Concurrent games (free tier) | ~57 at 5 min, ~11 at 1 min | ~10 full games online (Realtime cap) | ~45–50 |
| Cheating | not possible | host can do anything | not possible |
| Main limit | invocations, 5 GB egress | Realtime connections and messages | invocations, 5 GB egress |
| Main risk | Supabase CPU speed; project pause | host leaves; trust | same as a |

## What step 11A built (needed by every option)

- **`docs/supabase-multiplayer.sql`**, safe to run twice. Tables `games`, `game_players`, `game_states` and `game_commands`, plus the lobby functions `open_games()` and `taken_nations()`, with row-level security:
  - only approved testers (and owners) create or join games;
  - players read only their own games, and only their own commands;
  - state is written by the authority (the service role) or an owner.

  `supabase/test/multiplayer.sql` checks the policies on a real Postgres 16 (`npm run test:policies`).
- **`js/commands.js`**: every player order is a JSON command record. Single-player sends its orders through it too, and the authority will run the same checks. There are 22 kinds. Offers you can accept (treaties, trades, peace) are remembered, so a client can only accept what was really offered. `tools/check-commands.mjs` tests it.
- **Lobby** (`js/lobby.js`, `js/lobby-ui.js`), behind `MULTIPLAYER_PREVIEW = 'owners'` in `js/config.js`: create a game (era, map seed, speed, player limit), list open games, join and pick a nation, leave. Everyone else still sees "Multiplayer · Coming soon". The claude.ai preview and localhost use an in-browser demo lobby.

## Verify on Supabase (optional)

```sh
node tools/spike/server-tick.mjs prepare ww2 90
node tools/spike/server-tick.mjs prepare modern 120 --busy
node tools/spike/build-edge.mjs              # copies the game into supabase/functions/tick-spike/game/
supabase functions deploy tick-spike         # Supabase CLI, logged in to the project
curl -X POST "https://<project>.supabase.co/functions/v1/tick-spike" \
  -H "Authorization: Bearer <service role / secret key>" -d '{"era":"modern","hours":30,"busy":true}'
supabase functions delete tick-spike         # afterwards
```

The response gives the time of each phase on Supabase's hardware. If 30 game hours take more than about 1.2 s there, tick every 2–3 minutes instead of 5.
