// The game store for js/game-server.js on Supabase (service role: row-level
// security doesn't apply; the function does its own checks in index.ts).
// deno-lint-ignore-file no-explicit-any
type Client = any;

const must = ({ data, error }: { data: any; error: any }) => {
  if (error) throw new Error(error.message ?? String(error));
  return data;
};

export class SupabaseStore {
  constructor(private db: Client, private dataDir: URL) {}

  async mapData(era: string) {
    return JSON.parse(await Deno.readTextFile(new URL(`${era}.json`, this.dataDir)));
  }

  async game(id: string) { return must(await this.db.from('games').select('*').eq('id', id).maybeSingle()); }
  async players(id: string) { return must(await this.db.from('game_players').select('*').eq('game_id', id)); }
  async state(id: string) { return must(await this.db.from('game_states').select('tick, state').eq('game_id', id).maybeSingle()); }
  async pending(id: string) {
    return must(await this.db.from('game_commands').select('*').eq('game_id', id).eq('status', 'pending').order('id').limit(500));
  }

  async save(id: string, { state, tick, views, game, commands, aiPlayers }: any) {
    must(await this.db.from('game_states').upsert({ game_id: id, tick, state, updated_at: new Date().toISOString() }));
    if (views.length) {
      must(await this.db.from('game_views').upsert(views.map((v: any) => ({ game_id: id, nation_id: v.nation, tick, state: v.state, updated_at: new Date().toISOString() }))));
    }
    const applied = commands.filter((c: any) => c.status === 'applied').map((c: any) => c.id);
    if (applied.length) must(await this.db.from('game_commands').update({ status: 'applied', tick }).in('id', applied));
    for (const c of commands.filter((x: any) => x.status === 'rejected')) {
      must(await this.db.from('game_commands').update({ status: 'rejected', tick, result: c.result }).eq('id', c.id));
    }
    if (aiPlayers.length) must(await this.db.from('game_players').update({ ai_controlled: true }).eq('game_id', id).in('user_id', aiPlayers));
    // Last: the games row (its tick is what clients listen to).
    must(await this.db.from('games').update(game).eq('id', id));
  }
}
