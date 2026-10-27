/**
 * lobby-ui.js — The multiplayer lobby screen (step 11A, owners only for now).
 *
 * Shown only when config MULTIPLAYER_PREVIEW allows it (owners): everyone else
 * keeps the disabled "Multiplayer · Coming soon" menu item.
 *   list    open games (name, era, speed, seats taken), Create game, Refresh
 *   create  name, era, map seed (Fictional World), speed, player limit
 *   game    the game's facts, your seat, a nation picker (taken ones greyed
 *           out), Join / Leave
 * Playing a game needs the game authority (a later step), so a seat is all
 * there is for now; the screen says so.
 */

import { esc } from './ui-kit.js';
import { ERAS, getEra, loadEraData } from './eras.js';
import { generateMap } from './map.js';
import { SPEEDS } from './lobby.js';

export class LobbyUI {
  constructor(lobby) {
    this.lobby = lobby;
    this.el = document.getElementById('lobby-body');
    this.view = 'list';
    this.games = [];
    this.game = null;      // the game open in the 'game' view
    this.nations = null;   // its nations: [{ id, name, major }]
    this.taken = [];
    this.seat = null;
    this.pick = -1;
    this.filter = '';
    this.message = '';
    this.busy = false;
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('submit', (e) => { e.preventDefault(); this.createFromForm(e.target); });
    this.el.addEventListener('input', (e) => {
      if (e.target.id === 'lobby-filter') { this.filter = e.target.value; this.renderNations(); }
      if (e.target.name === 'era') this.el.querySelector('.lobby-seed').hidden = e.target.value !== 'fictional';
    });
  }

  async open() {
    this.view = 'list';
    this.message = '';
    await this.refresh();
  }

  async refresh() {
    this.busy = true;
    this.render();
    try { this.games = await this.lobby.list(); this.message = ''; } catch (err) { this.games = []; this.message = err.message; }
    this.busy = false;
    this.render();
  }

  render() {
    if (this.view === 'create') return this.renderCreate();
    if (this.view === 'game') return this.renderGame();
    const rows = this.games.map((g) => `<li class="lobby-game">
        <button type="button" class="lobby-open" data-game="${esc(g.id)}">
          <span class="lg-name">${esc(g.name)}${g.mine ? ' <span class="lg-mine">JOINED</span>' : ''}</span>
          <span class="lg-meta">${esc(getEra(g.era)?.label ?? g.era)}${g.map_seed ? ` · seed ${esc(g.map_seed)}` : ''} · 1 day per ${Number(g.minutes_per_day)} min</span>
          <span class="lg-seats" aria-label="${g.players} of ${g.max_players} players">${g.players}/${g.max_players}</span>
        </button></li>`).join('');
    this.el.innerHTML = `
      <div class="lobby-tools">
        <button type="button" class="btn primary small" data-lobby="create">Create game</button>
        <button type="button" class="btn ghost small" data-lobby="refresh" ${this.busy ? 'disabled' : ''}>${this.busy ? 'Loading…' : 'Refresh'}</button>
      </div>
      ${this.message ? `<p class="lobby-msg bad" role="alert">${esc(this.message)}</p>` : ''}
      ${this.games.length ? `<ul class="lobby-list" aria-label="Open games">${rows}</ul>` : this.busy ? '' : '<p class="hint">No open games yet. Create one.</p>'}
      <p class="lobby-note">Owner preview: games can be created and joined, but not played yet. The game server that runs them (even with everyone offline) comes in the next step.</p>`;
  }

  renderCreate() {
    const eras = ERAS.map((e) => `<option value="${e.id}" ${e.id === 'ww2' ? 'selected' : ''}>${esc(e.label)}${e.year ? ` (${esc(String(e.year))})` : ''}</option>`).join('');
    const speeds = SPEEDS.map((s) => `<option value="${s.minutes}" ${s.minutes === 4 ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
    this.el.innerHTML = `<form class="lobby-form" novalidate>
      <label>Name <input name="name" maxlength="60" required value="New campaign"></label>
      <label>Era <select name="era">${eras}</select></label>
      <label class="lobby-seed" hidden>Map seed <input name="seed" maxlength="40" value="${esc(`MP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`)}"></label>
      <label>Speed <select name="speed">${speeds}</select></label>
      <label>Players <input name="players" type="number" min="2" max="20" value="10"></label>
      ${this.message ? `<p class="lobby-msg bad" role="alert">${esc(this.message)}</p>` : ''}
      <div class="btn-row">
        <button type="submit" class="btn primary" ${this.busy ? 'disabled' : ''}>Create game</button>
        <button type="button" class="btn ghost" data-lobby="list">Cancel</button>
      </div>
      <p class="lobby-note">Computer nations fill every nation without a player.</p>
    </form>`;
  }

  async createFromForm(form) {
    const f = new FormData(form);
    const name = String(f.get('name') ?? '').trim();
    const players = Number(f.get('players'));
    if (!name) { this.message = 'Give the game a name.'; return this.render(); }
    if (!(players >= 2 && players <= 20)) { this.message = 'Players: 2 to 20.'; return this.render(); }
    this.busy = true;
    try {
      const g = await this.lobby.create({ name, era: String(f.get('era')), mapSeed: String(f.get('seed') ?? '').trim() || 'MP-1', minutesPerDay: Number(f.get('speed')), maxPlayers: players });
      this.message = '';
      this.busy = false;
      await this.openGame({ ...g, players: 0, mine: false });
    } catch (err) {
      this.busy = false;
      this.message = err.message;
      this.render();
    }
  }

  async openGame(g) {
    this.view = 'game';
    this.game = g;
    this.nations = null;
    this.pick = -1;
    this.filter = '';
    this.message = '';
    this.render();
    try {
      const [taken, seat, nations] = await Promise.all([this.lobby.taken(g.id), this.lobby.seat(g.id), nationsOf(g)]);
      this.taken = taken;
      this.seat = seat;
      this.nations = nations;
    } catch (err) { this.message = err.message; }
    this.render();
  }

  renderGame() {
    const g = this.game;
    const n = (id) => this.nations?.find((x) => x.id === id)?.name ?? `Nation ${id}`;
    this.el.innerHTML = `
      <div class="lobby-game-head">
        <h3>${esc(g.name)}</h3>
        <p class="lg-meta">${esc(getEra(g.era)?.label ?? g.era)}${g.map_seed ? ` · seed ${esc(g.map_seed)}` : ''} · 1 game day per ${Number(g.minutes_per_day)} real min · ${this.taken.length}/${g.max_players} players</p>
      </div>
      ${this.message ? `<p class="lobby-msg bad" role="alert">${esc(this.message)}</p>` : ''}
      ${this.seat ? `<div class="lobby-seat"><span>You play <b>${esc(n(this.seat.nation_id))}</b>.</span>
          <button type="button" class="btn ghost small" data-lobby="leave">Leave game</button></div>
          <p class="lobby-note">The game starts once the game server is running (next step). Your seat is kept.</p>`
        : `<div class="lobby-pick">
          <input id="lobby-filter" type="search" placeholder="Find a nation" aria-label="Find a nation" value="${esc(this.filter)}">
          <ul class="lobby-nations" role="listbox" aria-label="Nations"></ul>
          <button type="button" class="btn primary" data-lobby="join" ${this.pick >= 0 && !this.busy ? '' : 'disabled'}>${this.pick >= 0 ? `Join as ${esc(n(this.pick))}` : 'Pick a nation'}</button>
        </div>`}
      <div class="btn-row"><button type="button" class="btn ghost small" data-lobby="list">‹ All games</button></div>`;
    this.renderNations();
  }

  renderNations() {
    const ul = this.el.querySelector('.lobby-nations');
    if (!ul) return;
    if (!this.nations) { ul.innerHTML = '<li class="hint">Loading nations…</li>'; return; }
    const q = this.filter.trim().toLowerCase();
    const list = this.nations.filter((x) => !q || x.name.toLowerCase().includes(q)).slice(0, 80);
    ul.innerHTML = list.map((x) => {
      const taken = this.taken.includes(x.id);
      return `<li><button type="button" role="option" class="lobby-nation ${this.pick === x.id ? 'on' : ''}" data-nation="${x.id}" ${taken ? 'disabled' : ''} aria-selected="${this.pick === x.id}">
        <span>${esc(x.name)}</span><small>${taken ? 'taken' : x.major ? 'major power' : ''}</small></button></li>`;
    }).join('') || '<li class="hint">No nation matches.</li>';
  }

  async onClick(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.game) { const g = this.games.find((x) => x.id === b.dataset.game); if (g) this.openGame(g); return; }
    if (b.dataset.nation) { this.pick = Number(b.dataset.nation); this.renderGame(); return; }
    const a = b.dataset.lobby;
    if (a === 'create') { this.view = 'create'; this.message = ''; this.render(); }
    if (a === 'list') { this.view = 'list'; this.message = ''; await this.refresh(); }
    if (a === 'refresh') await this.refresh();
    if (a === 'join' || a === 'leave') {
      this.busy = true;
      try {
        if (a === 'join') await this.lobby.join(this.game.id, this.pick); else await this.lobby.leave(this.game.id);
        this.busy = false;
        await this.openGame(this.game);
      } catch (err) {
        this.busy = false;
        this.message = err.message;
        this.taken = await this.lobby.taken(this.game.id).catch(() => this.taken);
        this.render();
      }
    }
  }
}

/** The nations a game's map has (ids as in the game), major powers first. */
async function nationsOf(g) {
  const era = getEra(g.era);
  const list = era.fictional ? generateMap(g.map_seed ?? 'MP-1').nations : (await loadEraData(era.id)).nations;
  return list.map((n, id) => ({ id, name: n.name, major: !!n.major })).sort((a, b) => b.major - a.major || a.name.localeCompare(b.name));
}
