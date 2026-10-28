// A stand-in for @supabase/supabase-js in tests of the tick Edge Function
// (tools/check-tick-function.mjs). Tables live in globalThis.__FAKE_DB__ =
// { tables: { games: [], … }, users: { jwt: userId }, rpc: { name(args) } }.
// It covers the query shapes the function uses: select / eq / in / order /
// limit / maybeSingle / single, insert, upsert (by primary key), update.
const PK = { games: ['id'], game_players: ['game_id', 'user_id'], game_states: ['game_id'], game_views: ['game_id', 'nation_id'], game_commands: ['id'] };

export function createClient() {
  const db = globalThis.__FAKE_DB__;
  const table = (name) => (db.tables[name] ??= []);
  const from = (name) => {
    const q = { op: 'select', filters: [], order: null, limit: null, payload: null };
    const rows = () => {
      let r = table(name).filter((row) => q.filters.every(([k, test]) => test(row[k])));
      if (q.order) r = [...r].sort((a, b) => (a[q.order] < b[q.order] ? -1 : a[q.order] > b[q.order] ? 1 : 0));
      if (q.limit != null) r = r.slice(0, q.limit);
      return r;
    };
    const run = (single) => {
      db.log?.push(`${q.op} ${name}`);
      if (q.op === 'upsert' || q.op === 'insert') {
        for (const p of [].concat(q.payload)) {
          const keys = PK[name];
          const i = table(name).findIndex((row) => keys.every((k) => row[k] === p[k]));
          if (i >= 0 && q.op === 'upsert') table(name)[i] = { ...table(name)[i], ...p }; else table(name).push({ ...p });
        }
        return { data: null, error: null };
      }
      if (q.op === 'update') { for (const row of rows()) Object.assign(row, q.payload); return { data: null, error: null }; }
      const r = structuredClone(rows());
      return { data: single ? r[0] ?? null : r, error: null };
    };
    const api = {
      select() { return api; },
      eq(k, v) { q.filters.push([k, (x) => x === v]); return api; },
      in(k, vs) { q.filters.push([k, (x) => vs.includes(x)]); return api; },
      order(k) { q.order = k; return api; },
      limit(n) { q.limit = n; return api; },
      insert(p) { q.op = 'insert'; q.payload = p; return api; },
      upsert(p) { q.op = 'upsert'; q.payload = p; return api; },
      update(p) { q.op = 'update'; q.payload = p; return api; },
      maybeSingle() { return Promise.resolve(run(true)); },
      single() { return Promise.resolve(run(true)); },
      then(res, rej) { return Promise.resolve(run(false)).then(res, rej); },
    };
    return api;
  };
  return {
    from,
    rpc: async (name, args) => db.rpc[name](args),
    auth: { getUser: async (jwt) => ({ data: { user: db.users[jwt] ? { id: db.users[jwt] } : null }, error: null }) },
  };
}
