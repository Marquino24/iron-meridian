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

  function query(table) {
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
    async rpc(name) { return { data: name === 'is_owner' ? isOwner(load()) : null, error: null }; },
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
