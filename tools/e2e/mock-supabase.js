// Fake Supabase client for browser tests of the launcher (injected with
// Playwright's addInitScript). It mimics the parts the game uses and the
// rules in docs/supabase-setup.sql: a user sees only their own row, the owner
// sees all and is the only one who can change status, rows are created
// pending (approved for the owner), and Realtime channels get updates.
(() => {
  const OWNER = 'owner@example.com';
  const LS = 'mock-supabase';
  const load = () => JSON.parse(localStorage.getItem(LS) || '{"session":null,"rows":[]}');
  const save = (db) => localStorage.setItem(LS, JSON.stringify(db));
  const channels = [];
  const authListeners = [];

  const isOwner = (db) => db.session?.user?.email === OWNER;
  const visible = (db) => (isOwner(db) ? db.rows : db.rows.filter((r) => r.user_id === db.session?.user?.id));
  const notify = (row) => { for (const c of channels) for (const h of c.handlers) if (!h.filter || h.filter === `user_id=eq.${row.user_id}`) h.cb({ new: row }); };

  // Multiplayer lobby tables (docs/supabase-multiplayer.sql), simplified: approved
  // users list open games and join as themselves; a nation is taken once.
  const approved = (db) => isOwner(db) || db.rows.some((r) => r.user_id === db.session?.user?.id && r.status === 'approved');
  function lobbyQuery(table) {
    const q = { op: 'select', filters: [], payload: null };
    const run = async (single) => {
      const db = load();
      db.games ??= []; db.players ??= [];
      const me = db.session?.user?.id;
      if (!me) return { data: null, error: { message: 'not signed in' } };
      if (table === 'games' && q.op === 'insert') {
        if (!approved(db)) return { data: null, error: { message: 'Only approved beta testers can create games' } };
        const g = { id: `g-${db.games.length + 1}`, ...q.payload, name: q.payload.name.trim(), status: 'open', created_by: me, created_at: new Date().toISOString() };
        db.games.push(g); save(db);
        return { data: g, error: null };
      }
      if (table === 'game_players' && q.op === 'insert') {
        const p = q.payload, g = db.games.find((x) => x.id === p.game_id);
        if (!approved(db) || p.user_id !== me) return { data: null, error: { message: 'Only approved beta testers can join games' } };
        if (db.players.some((x) => x.game_id === p.game_id && x.nation_id === p.nation_id)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "game_players_game_id_nation_id_key"' } };
        if (db.players.filter((x) => x.game_id === p.game_id).length >= g.max_players) return { data: null, error: { message: 'This game is full' } };
        db.players.push({ ...p, joined_at: new Date().toISOString() }); save(db);
        return { data: null, error: null };
      }
      let rows = table === 'games' ? db.games.filter((g) => g.created_by === me || db.players.some((p) => p.game_id === g.id && p.user_id === me))
        : db.players.filter((p) => db.players.some((x) => x.game_id === p.game_id && x.user_id === me));
      for (const [k, v] of q.filters) rows = rows.filter((r) => r[k] === v);
      if (q.op === 'delete') {
        const gone = new Set(rows.filter((r) => r.user_id === me));
        db.players = db.players.filter((r) => !gone.has(r) && !(r.user_id === me && rows.some((x) => x.game_id === r.game_id && x.user_id === r.user_id)));
        save(db);
        return { data: null, error: null };
      }
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const api = {
      select() { return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      insert(p) { q.op = 'insert'; q.payload = p; return api; },
      delete() { q.op = 'delete'; return api; },
      single() { return run(true); },
      maybeSingle() { return run(true); },
      then(res, rej) { return run(false).then(res, rej); },
    };
    return api;
  }
  function lobbyRpc(name, args) {
    const db = load();
    db.games ??= []; db.players ??= [];
    if (!approved(db)) return name === 'open_games' ? [] : [];
    if (name === 'open_games') {
      return db.games.filter((g) => ['open', 'running'].includes(g.status)).map((g) => ({ ...g,
        players: db.players.filter((p) => p.game_id === g.id).length,
        mine: db.players.some((p) => p.game_id === g.id && p.user_id === db.session.user.id) })).reverse();
    }
    return db.players.filter((p) => p.game_id === args.g).map((p) => p.nation_id).sort((a, b) => a - b);
  }

  function query(table) {
    if (table === 'games' || table === 'game_players') return lobbyQuery(table);
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
      const ch = { handlers: [] };
      ch.on = (_evt, opts, cb) => { ch.handlers.push({ filter: opts.filter, cb }); return ch; };
      ch.subscribe = () => { channels.push(ch); return ch; };
      return ch;
    },
    removeChannel(ch) { const i = channels.indexOf(ch); if (i >= 0) channels.splice(i, 1); },
  });

  // Test helper: the owner approving/denying from another device.
  window.__mockDecide = (userId, status) => {
    const db = load();
    const r = db.rows.find((x) => x.user_id === userId);
    r.status = status; save(db); notify(r);
  };
})();
