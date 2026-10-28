// Fake Supabase client for browser tests of the launcher (injected with
// Playwright's addInitScript). It mimics the parts the game uses and the
// rules in docs/supabase-setup.sql: a user sees only their own row, the owner
// sees all and is the only one who can change status, rows are created
// pending (approved for the owner), and Realtime channels get updates.
(() => {
  const OWNER = 'owner@example.com';
  const LS = 'mock-supabase';
  // window.__mockSessionPerTab: each tab signs in on its own (two accounts in one
  // browser), the "database" is shared through localStorage.
  const perTab = () => !!window.__mockSessionPerTab;
  const load = () => {
    const d = JSON.parse(localStorage.getItem(LS) || '{"session":null,"rows":[]}');
    if (perTab()) d.session = JSON.parse(sessionStorage.getItem(`${LS}:session`) || 'null');
    return d;
  };
  const save = (db) => {
    const d = { ...db };
    if (perTab()) {
      sessionStorage.setItem(`${LS}:session`, JSON.stringify(db.session ?? null));
      d.session = JSON.parse(localStorage.getItem(LS) || '{}').session ?? null;
    }
    localStorage.setItem(LS, JSON.stringify(d));
  };
  const channels = [];
  const authListeners = [];

  const isOwner = (db) => !!db.session && (window.__mockOwners ?? [OWNER]).includes(db.session.user.email);
  const visible = (db) => (isOwner(db) ? db.rows : db.rows.filter((r) => r.user_id === db.session?.user?.id));
  const notify = (row) => { for (const c of channels) for (const h of c.handlers) if (!h.filter || h.filter === `user_id=eq.${row.user_id}`) h.cb({ new: row }); };

  // Multiplayer tables (docs/supabase-multiplayer*.sql), simplified but with the
  // same rules: approved users create and join; players read their own games,
  // views and orders; orders only for their own nation, 20 a minute; the tick
  // (functions.invoke('tick')) runs the real js/game-server.js on this "database".
  const approved = (db) => isOwner(db) || db.rows.some((r) => r.user_id === db.session?.user?.id && r.status === 'approved');
  const mpHandlers = [];
  const notifyMp = () => { for (const h of mpHandlers) setTimeout(() => h.cb({}), 0); };
  window.addEventListener('storage', (e) => { if (e.key === LS) notifyMp(); });
  const ACTIVE = ['open', 'running', 'paused'];
  const fail = (message, code) => ({ data: null, error: { message, code } });
  function mp(db) { db.games ??= []; db.players ??= []; db.states ??= {}; db.views ??= {}; db.commands ??= []; return db; }
  function lobbyQuery(table) {
    const q = { op: 'select', filters: [], payload: null, order: null, asc: true, limit: null };
    const run = async (single) => {
      const db = mp(load());
      const me = db.session?.user?.id;
      if (!me) return fail('not signed in');
      const seated = (gid) => db.players.find((p) => p.game_id === gid && p.user_id === me);
      const match = (rows) => rows.filter((r) => q.filters.every(([k, v]) => r[k] === v));
      const done = (data) => { save(db); notifyMp(); return { data, error: null }; };
      if (table === 'games') {
        if (q.op === 'insert') {
          if (!approved(db)) return fail('Only approved beta testers can create games');
          if (db.games.filter((g) => ACTIVE.includes(g.status)).length >= (window.__mockMaxActive ?? 40)) return fail('The server is full: 40 active games (the free tier\'s limit). Try again when one ends.');
          if (!isOwner(db) && db.games.filter((g) => g.created_by === me && ACTIVE.includes(g.status)).length >= 2) return fail('You already run 2 active games (limit 2). Finish one first.');
          const g = { inactive_days: 7, auto_start: true, tick: 0, ticked_at: null, ...q.payload, id: `00000000-0000-4000-8000-${String(db.games.length + 1).padStart(12, '0')}`, name: q.payload.name.trim(), status: 'open', created_by: me, created_at: new Date().toISOString() };
          db.games.push(g);
          return done(g);
        }
        const mine = db.games.filter((g) => g.created_by === me || seated(g.id) || isOwner(db));
        if (q.op === 'update') {
          for (const g of match(mine)) {
            if (g.created_by !== me && !isOwner(db)) continue; // RLS: creator or owner
            const to = q.payload.status;
            if (to && to !== g.status) {
              if (g.status === 'finished') return fail('This game has ended');
              if (to === 'open') return fail('A game can\'t go back to the lobby');
              if (to === 'running' && g.status === 'open') Object.assign(g, { started_at: new Date().toISOString(), ticked_at: null });
              if (to === 'running' && g.status === 'paused') g.ticked_at = new Date().toISOString();
              g.status = to;
            }
          }
          return done(null);
        }
        const rows = match(mine);
        return { data: single ? rows[0] ?? null : rows, error: null };
      }
      if (table === 'game_players') {
        if (q.op === 'insert') {
          const p = q.payload, g = db.games.find((x) => x.id === p.game_id);
          if (!approved(db) || p.user_id !== me) return fail('Only approved beta testers can join games');
          if (!g || !['open', 'running'].includes(g.status)) return fail('This game is not taking players');
          if (!isOwner(db) && db.players.filter((x) => x.user_id === me && ACTIVE.includes(db.games.find((y) => y.id === x.game_id)?.status)).length >= 3) return fail('You already play in 3 active games (limit 3).');
          if (db.players.some((x) => x.game_id === p.game_id && x.nation_id === p.nation_id)) return fail('duplicate key value violates unique constraint "game_players_game_id_nation_id_key"', '23505');
          const seats = db.players.filter((x) => x.game_id === p.game_id).length;
          if (seats >= g.max_players) return fail('This game is full');
          db.players.push({ ...p, joined_at: new Date().toISOString(), last_seen: new Date().toISOString(), ai_controlled: false });
          if (g.status === 'open' && g.auto_start !== false && seats + 1 >= g.max_players) Object.assign(g, { status: 'running', started_at: new Date().toISOString(), ticked_at: null });
          return done(null);
        }
        const visible = db.players.filter((x) => seated(x.game_id));
        if (q.op === 'delete') { const gone = new Set(match(visible).filter((x) => x.user_id === me)); db.players = db.players.filter((x) => !gone.has(x)); return done(null); }
        if (q.op === 'update') { for (const x of match(visible)) if (x.user_id === me && 'last_seen' in q.payload) x.last_seen = q.payload.last_seen; return done(null); }
        const rows = match(visible);
        return { data: single ? rows[0] ?? null : rows, error: null };
      }
      if (table === 'game_views') {
        const rows = match(Object.values(db.views).filter((v) => seated(v.game_id)?.nation_id === v.nation_id));
        return { data: single ? rows[0] ?? null : rows, error: null };
      }
      if (table === 'game_commands') {
        if (q.op === 'insert') {
          const c = q.payload, seat = seated(c.game_id), g = db.games.find((x) => x.id === c.game_id);
          if (!seat || seat.nation_id !== c.nation_id) return fail('You can only give orders to your own nation');
          if (!['open', 'running'].includes(g?.status)) return fail('This game is not running');
          if (db.commands.filter((x) => x.user_id === me && Date.now() - Date.parse(x.created_at) < 60000).length >= 20) return fail('Too many orders: at most 20 a minute. Wait a moment.');
          const row = { id: (db.commands.at(-1)?.id ?? 0) + 1, game_id: c.game_id, user_id: me, nation_id: c.nation_id, kind: c.kind, payload: c.payload ?? {}, status: 'pending', result: null, created_at: new Date().toISOString() };
          db.commands.push(row);
          return done({ id: row.id });
        }
        let rows = match(db.commands.filter((x) => x.user_id === me));
        if (q.order) rows = [...rows].sort((x, y) => (q.asc ? x.id - y.id : y.id - x.id));
        if (q.limit != null) rows = rows.slice(0, q.limit);
        return { data: single ? rows[0] ?? null : rows, error: null };
      }
      return fail(`mock: no table ${table}`);
    };
    const api = {
      select() { return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      order(k, o) { q.order = k; q.asc = o?.ascending !== false; return api; },
      limit(n) { q.limit = n; return api; },
      insert(p) { q.op = 'insert'; q.payload = p; return api; },
      update(p) { q.op = 'update'; q.payload = p; return api; },
      delete() { q.op = 'delete'; return api; },
      single() { return run(true); },
      maybeSingle() { return run(true); },
      then(res, rej) { return run(false).then(res, rej); },
    };
    return api;
  }
  function lobbyRpc(name, args) {
    const db = mp(load());
    const me = db.session?.user?.id;
    if (!approved(db)) return [];
    if (name === 'open_games') {
      return db.games.filter((g) => ACTIVE.includes(g.status) || db.players.some((p) => p.game_id === g.id && p.user_id === me)).map((g) => ({ ...g,
        players: db.players.filter((p) => p.game_id === g.id).length,
        mine: db.players.some((p) => p.game_id === g.id && p.user_id === me), created_by_me: g.created_by === me })).reverse();
    }
    return db.players.filter((p) => p.game_id === args.g).map((p) => p.nation_id).sort((a, b) => a - b);
  }
  // The tick Edge Function: seated players only, one on-demand tick per game per cooldown.
  const lastTick = {};
  // Test helper: the schedule's tick (pg_cron), with nobody signed in.
  window.__mockScheduleTick = async (game) => { window.__mockTickAsSchedule = true; try { return (await invokeTick({ game })).data; } finally { window.__mockTickAsSchedule = false; } };
  async function invokeTick({ game }) {
    const db = mp(load());
    const me = db.session?.user?.id;
    if (!db.players.some((p) => p.game_id === game && p.user_id === me) && !window.__mockTickAsSchedule) return { data: null, error: { message: 'you are not in this game' } };
    const cool = window.__mockTickCooldownMs ?? 2000;
    const shared = JSON.parse(localStorage.getItem(`${LS}:lastTick`) || '{}');
    if (!window.__mockTickAsSchedule && Date.now() - (shared[game] ?? 0) < cool) return { data: { skipped: 'ticked moments ago: your order applies on the next tick' }, error: null };
    shared[game] = Date.now();
    localStorage.setItem(`${LS}:lastTick`, JSON.stringify(shared));
    lastTick[game] = Date.now();
    const [{ tickGame }, { LocalStore }, { loadEraData }] = await Promise.all([import('./js/game-server.js'), import('./js/mp-local-store.js'), import('./js/eras.js')]);
    const store = new LocalStore({ load: () => mp(load()), save: (d) => save(d) }, loadEraData);
    const r = await tickGame(store, game);
    notifyMp();
    return { data: r, error: null };
  }

  function query(table) {
    if (['games', 'game_players', 'game_views', 'game_commands'].includes(table)) return lobbyQuery(table);
    const q = { filters: [], op: 'select', payload: null, single: false, wantRows: true };
    const run = async () => {
      const db = load();
      if (!db.session) return { data: null, error: { message: 'not signed in' } };
      if (q.op === 'insert') {
        const u = db.session.user;
        if (q.payload.user_id !== u.id) return { data: null, error: { message: 'You can only request access for your own account' } };
        if (db.rows.some((r) => r.user_id === u.id)) return { data: null, error: { code: '23505', message: 'duplicate' } };
        const row = { user_id: u.id, provider: u.app_metadata.provider, display_name: u.user_metadata.full_name, email: u.email,
          status: isOwner(db) ? 'approved' : 'pending', requested_at: new Date().toISOString(), decided_at: null };
        db.rows.push(row); save(db); notify(row);
        return { data: null, error: null };
      }
      let rows = visible(db);
      for (const [k, v] of q.filters) rows = rows.filter((r) => r[k] === v);
      if (q.op === 'update') {
        if (!isOwner(db)) rows = []; // RLS: only the owner matches
        for (const r of rows) { Object.assign(r, q.payload, { decided_at: new Date().toISOString() }); notify(r); }
        save(db);
      }
      if (q.order) rows = [...rows].sort((a, b) => (a[q.order] < b[q.order] ? 1 : -1));
      return { data: q.single ? rows[0] ?? null : rows, error: null };
    };
    const api = {
      select() { return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      order(k) { q.order = k; return api; },
      maybeSingle() { q.single = true; return run(); },
      insert(p) { q.op = 'insert'; q.payload = p; return run(); },
      update(p) { q.op = 'update'; q.payload = p; return api; },
      then(res, rej) { return run().then(res, rej); },
    };
    return api;
  }

  window.__IM_SUPABASE_FACTORY__ = () => ({
    auth: {
      async getSession() { return { data: { session: load().session }, error: null }; },
      onAuthStateChange(cb) { authListeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithOAuth({ provider, options }) {
        // Tests can switch a provider off (as if not set up in Supabase).
        if ((window.__mockDisabled ?? []).includes(provider)) return { error: { message: 'Unsupported provider: provider is not enabled' } };
        const db = load();
        db.lastRedirect = options?.redirectTo ?? null;
        const email = window.__mockNextEmail || `${provider}.player@example.com`;
        db.session = { user: { id: `u-${email}`, email, app_metadata: { provider }, user_metadata: { full_name: window.__mockNextName || `${provider[0].toUpperCase()}${provider.slice(1)} Player` } } };
        save(db);
        setTimeout(() => location.reload(), 50); // the real flow leaves for the provider and comes back
        return { error: null };
      },
      async signInWithOtp() { return { error: null }; },
      async signOut() { const db = load(); db.session = null; save(db); for (const cb of authListeners) cb('SIGNED_OUT', null); return { error: null }; },
    },
    async rpc(name, args) {
      if (name === 'open_games' || name === 'taken_nations') {
        if (window.__mockNoMultiplayer) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.open_games without parameters in the schema cache' } };
        return { data: lobbyRpc(name, args), error: null };
      }
      return { data: name === 'is_owner' ? isOwner(load()) : null, error: null };
    },
    from: query,
    channel() {
      const ch = { handlers: [], mp: [] };
      ch.on = (_evt, opts, cb) => {
        if (opts.table === 'games' || opts.table === 'game_commands') ch.mp.push({ table: opts.table, cb });
        else ch.handlers.push({ filter: opts.filter, cb });
        return ch;
      };
      ch.subscribe = () => { channels.push(ch); mpHandlers.push(...ch.mp); return ch; };
      return ch;
    },
    removeChannel(ch) {
      const i = channels.indexOf(ch); if (i >= 0) channels.splice(i, 1);
      for (const h of ch.mp ?? []) { const j = mpHandlers.indexOf(h); if (j >= 0) mpHandlers.splice(j, 1); }
    },
    functions: { async invoke(name, { body }) { return name === 'tick' ? invokeTick(body) : { data: null, error: { message: `no function ${name}` } }; } },
  });

  // Test helper: the owner approving/denying from another device.
  window.__mockDecide = (userId, status) => {
    const db = load();
    const r = db.rows.find((x) => x.user_id === userId);
    r.status = status; save(db); notify(r);
  };
})();
