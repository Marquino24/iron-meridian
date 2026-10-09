/**
 * launcher.js — Sign-in screen, beta gate and admin panel.
 *
 * Flow: sign-in → beta gate (request / pending / denied) → game start screen.
 * `run()` resolves once the player may play. A remembered session skips the
 * sign-in screen entirely; an approved player goes straight through.
 *
 * The owner (decided by the database, see is_owner() in supabase/schema.sql)
 * is always let in and gets an Admin button on every screen.
 */

import { PROVIDERS } from './config.js';
import { brandIcon } from './brand-icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PROVIDER_LABEL = Object.fromEntries([...PROVIDERS.map((p) => [p.id, p.label]), ['email', 'Email link'], ['twitter', 'X']]);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const STATUS_TEXT = { pending: 'Pending', approved: 'Approved', denied: 'Denied' };

export class Launcher {
  /** @param {import('./auth.js').AuthService} auth */
  constructor(auth) {
    this.auth = auth;
    this.root = $('#launcher');
    this.card = $('#launcher-card');
    this.adminPanel = $('#admin-panel');
    this.isOwner = false;
    this.stopWatch = null;
    this.pollTimer = 0;
    this.admin = { tab: 'pending', rows: [], busy: new Set(), error: '', stop: null };

    for (const b of document.querySelectorAll('[data-open-admin]')) b.addEventListener('click', () => this.openAdmin());
    this.adminPanel.addEventListener('click', (e) => this.onAdminClick(e));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.adminPanel.hidden) this.closeAdmin(); });
    for (const b of document.querySelectorAll('[data-sign-out]')) b.addEventListener('click', () => this.signOut());
  }

  /** Resolves when the signed-in player has access. */
  run() {
    this.show();
    return new Promise((resolve) => {
      this.resolveAccess = resolve;
      this.start();
    });
  }

  show() {
    this.root.hidden = false;
    document.body.classList.add('gated');
  }

  hide() {
    this.root.hidden = true;
    document.body.classList.remove('gated');
  }

  async start() {
    this.render('loading', { text: 'Connecting to command…' });
    try {
      await this.auth.init();
    } catch (err) {
      this.render('error', { text: `Sign-in service unavailable: ${err.message}` });
      return;
    }
    this.auth.onChange((event) => {
      if (event === 'SIGNED_OUT') location.reload();
    });
    if (this.auth.user) await this.checkAccess();
    else this.render('signin');
  }

  async checkAccess() {
    this.render('loading', { text: 'Checking clearance…' });
    try {
      this.isOwner = await this.auth.isOwner();
      this.setOwnerUi();
      let row = await this.auth.myBetaRow();
      if (this.isOwner) {
        if (!row) row = await this.auth.requestAccess(); // owner's row is created approved
        return this.grant();
      }
      if (!row) return this.render('request');
      this.onRow(row);
    } catch (err) {
      this.render('error', { text: `Could not check your access: ${err.message}` });
    }
  }

  onRow(row) {
    if (!row) return this.render('request');
    if (row.status === 'approved') return this.grant();
    if (row.status === 'denied') { this.stopWatching(); return this.render('denied', { row }); }
    this.render('pending', { row });
    this.watchPending();
  }

  /** Live updates (Realtime) plus a slow poll as a safety net. */
  watchPending() {
    if (this.stopWatch) return;
    this.stopWatch = this.auth.watchMyRow((row) => this.onRow(row));
    this.pollTimer = setInterval(async () => {
      try { this.onRow(await this.auth.myBetaRow()); } catch { /* keep waiting */ }
    }, 20000);
  }

  stopWatching() {
    this.stopWatch?.();
    this.stopWatch = null;
    clearInterval(this.pollTimer);
  }

  grant() {
    this.stopWatching();
    this.hide();
    const account = $('#account');
    if (account) {
      account.hidden = false;
      $('#account-name').textContent = this.auth.displayName;
      $('#account-provider').innerHTML = brandIcon(this.auth.provider, 14);
    }
    this.resolveAccess?.({ owner: this.isOwner });
    this.resolveAccess = null;
  }

  setOwnerUi() {
    document.body.classList.toggle('is-owner', this.isOwner);
    for (const b of document.querySelectorAll('[data-open-admin]')) b.hidden = !this.isOwner;
  }

  async signOut() {
    this.stopWatching();
    try { await this.auth.signOut(); } finally { location.reload(); }
  }

  // --- Screens -----------------------------------------------------------------

  render(screen, opts = {}) {
    this.screen = screen;
    const user = this.auth.user;
    const who = user
      ? `<div class="who">${brandIcon(this.auth.provider, 16)}<span><b>${escapeHtml(this.auth.displayName)}</b><small>${escapeHtml(user.email ?? '')}</small></span></div>`
      : '';
    const signOut = '<button type="button" class="link-btn" data-action="sign-out">Sign out</button>';

    switch (screen) {
      case 'loading':
        this.card.innerHTML = `<div class="card-status"><span class="spinner" aria-hidden="true"></span><p>${escapeHtml(opts.text)}</p></div>`;
        break;

      case 'signin': {
        const buttons = PROVIDERS.map((p) => `
          <button type="button" class="provider-btn" data-provider="${p.id}" ${p.enabled ? '' : 'disabled aria-disabled="true"'}>
            <span class="provider-icon">${brandIcon(p.id, 20)}</span>
            <span class="provider-label">${p.enabled ? `Continue with ${escapeHtml(p.label)}` : escapeHtml(p.label)}</span>
            ${p.enabled ? '' : '<span class="soon">Coming soon</span>'}
          </button>`).join('');
        this.card.innerHTML = `
          <h2>Sign in</h2>
          <p class="card-lead">Use any account below. You'll stay signed in on this device.</p>
          <div class="provider-list">${buttons}</div>
          <div class="divider"><span>or</span></div>
          <form class="magic-form" novalidate>
            <label for="magic-email">Email</label>
            <div class="magic-row">
              <input id="magic-email" type="email" autocomplete="email" placeholder="you@example.com" required>
              <button type="submit" class="btn">${brandIcon('email', 16)} Email me a link</button>
            </div>
          </form>
          <p class="card-msg" role="status" aria-live="polite">${escapeHtml(opts.message ?? '')}</p>
          <p class="fine">Closed beta. New accounts need approval before they can play. <a href="privacy.html" target="_blank" rel="noopener">Privacy</a> · <a href="terms.html" target="_blank" rel="noopener">Terms</a></p>`;
        this.card.querySelector('.provider-list').addEventListener('click', (e) => {
          const b = e.target.closest('[data-provider]');
          if (b && !b.disabled) this.signInWith(b.dataset.provider, b);
        });
        this.card.querySelector('.magic-form').addEventListener('submit', (e) => { e.preventDefault(); this.sendLink(); });
        break;
      }

      case 'link-sent':
        this.card.innerHTML = `
          <div class="card-status">
            <span class="status-icon">${brandIcon('email', 34)}</span>
            <h2>Check your email</h2>
            <p>We sent a sign-in link to <b>${escapeHtml(opts.email)}</b>. Open it <b>in this browser</b> to continue.</p>
            <button type="button" class="link-btn" data-action="back">Use a different method</button>
          </div>`;
        break;

      case 'request':
        this.card.innerHTML = `
          ${who}
          <h2>Request beta access</h2>
          <p class="card-lead">Iron Meridian is in closed beta. Send a request and the commander will review it. You'll get in as soon as it's approved.</p>
          <button type="button" class="btn primary" data-action="request">REQUEST BETA ACCESS</button>
          <p class="card-msg" role="status" aria-live="polite"></p>
          <div class="card-foot">${signOut}</div>`;
        break;

      case 'pending':
        this.card.innerHTML = `
          ${who}
          <div class="card-status">
            <span class="radar" aria-hidden="true"></span>
            <h2>Pending approval</h2>
            <p>Your request was sent ${escapeHtml(fmtDate(opts.row?.requested_at))}. This screen updates by itself when you're approved. You can close it and come back later.</p>
          </div>
          <div class="card-foot">${signOut}</div>`;
        break;

      case 'denied':
        this.card.innerHTML = `
          ${who}
          <div class="card-status">
            <span class="status-icon denied" aria-hidden="true">✕</span>
            <h2>Access not granted</h2>
            <p>Your request for the beta wasn't approved this time.</p>
          </div>
          <div class="card-foot">${signOut}</div>`;
        break;

      case 'error':
        this.card.innerHTML = `
          <div class="card-status">
            <span class="status-icon denied" aria-hidden="true">!</span>
            <h2>Something went wrong</h2>
            <p>${escapeHtml(opts.text)}</p>
            <button type="button" class="btn" data-action="retry">Try again</button>
          </div>
          ${user ? `<div class="card-foot">${signOut}</div>` : ''}`;
        break;
    }

    this.card.onclick = (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'sign-out') this.signOut();
      if (a === 'retry') location.reload();
      if (a === 'back') this.render('signin');
      if (a === 'request') this.requestAccess(e.target.closest('button'));
    };
  }

  setMessage(text, isError = false) {
    const m = this.card.querySelector('.card-msg');
    if (!m) return;
    m.textContent = text;
    m.classList.toggle('error', isError);
  }

  async signInWith(provider, button) {
    const p = PROVIDERS.find((x) => x.id === provider);
    for (const b of this.card.querySelectorAll('.provider-btn')) b.disabled = true;
    button.classList.add('busy');
    this.setMessage(`Opening ${p.label}…`);
    try {
      await this.auth.signInWithProvider(provider, p.scopes);
    } catch (err) {
      this.render('signin');
      const notEnabled = /not enabled|unsupported provider/i.test(err.message);
      this.setMessage(notEnabled ? `${p.label} sign-in isn't switched on yet. Try another option.` : `Couldn't start ${p.label} sign-in: ${err.message}`, true);
    }
  }

  async sendLink() {
    const input = this.card.querySelector('#magic-email');
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.setMessage('Enter a valid email address.', true);
      input.focus();
      return;
    }
    const btn = this.card.querySelector('.magic-form button');
    btn.disabled = true;
    this.setMessage('Sending…');
    try {
      await this.auth.sendMagicLink(email);
      this.render('link-sent', { email });
    } catch (err) {
      btn.disabled = false;
      this.setMessage(/rate limit|security purposes/i.test(err.message) ? 'Too many emails just now. Wait a minute and try again.' : `Couldn't send the link: ${err.message}`, true);
    }
  }

  async requestAccess(button) {
    button.disabled = true;
    this.setMessage('Sending request…');
    try {
      this.onRow(await this.auth.requestAccess());
    } catch (err) {
      button.disabled = false;
      this.setMessage(`Couldn't send the request: ${err.message}`, true);
    }
  }

  // --- Admin panel ------------------------------------------------------------------

  async openAdmin() {
    if (!this.isOwner) return;
    this.adminPanel.hidden = false;
    this.renderAdmin(true);
    await this.reloadTesters();
    if (!this.admin.stop) {
      this.admin.stop = this.auth.watchAll(() => this.reloadTesters());
    }
  }

  closeAdmin() {
    this.adminPanel.hidden = true;
    this.admin.stop?.();
    this.admin.stop = null;
  }

  async reloadTesters() {
    try {
      this.admin.rows = await this.auth.listTesters();
      this.admin.error = '';
    } catch (err) {
      this.admin.error = `Couldn't load testers: ${err.message}`;
    }
    this.renderAdmin();
  }

  renderAdmin(loading = false) {
    const { rows, tab, busy, error } = this.admin;
    const counts = { pending: 0, approved: 0, denied: 0 };
    for (const r of rows) counts[r.status]++;
    const ownId = this.auth.user?.id;
    const list = rows.filter((r) => r.status === tab);

    const rowHtml = (r) => {
      const isSelf = r.user_id === ownId;
      const dis = (action) => (busy.has(r.user_id) || isSelf
        || (action === 'approved' && r.status === 'approved')
        || (action === 'denied' && r.status === 'denied')
        || (action === 'pending' && r.status === 'pending')) ? 'disabled' : '';
      return `
        <tr>
          <td data-label="Name"><b>${escapeHtml(r.display_name)}</b>${isSelf ? ' <span class="owner-tag">OWNER</span>' : ''}</td>
          <td data-label="Email" class="email">${escapeHtml(r.email)}</td>
          <td data-label="Provider"><span class="prov">${brandIcon(r.provider, 14)}${escapeHtml(PROVIDER_LABEL[r.provider] ?? r.provider)}</span></td>
          <td data-label="Requested" class="date">${escapeHtml(fmtDate(r.requested_at))}</td>
          <td class="actions">
            <button type="button" class="act approve" data-set="approved" data-user="${r.user_id}" ${dis('approved')}>Approve</button>
            <button type="button" class="act deny" data-set="denied" data-user="${r.user_id}" ${dis('denied')}>Deny</button>
            <button type="button" class="act revoke" data-set="pending" data-user="${r.user_id}" ${dis('pending')} title="Withdraw the decision: the tester goes back to Pending">Revoke</button>
          </td>
        </tr>`;
    };

    this.adminPanel.innerHTML = `
      <div class="admin-sheet" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <header class="admin-head">
          <div>
            <div class="eyebrow">COMMAND · BETA ROSTER</div>
            <h2 id="admin-title">Testers <span class="total">${rows.length} total</span></h2>
          </div>
          <div class="admin-head-actions">
            <button type="button" class="btn ghost small" data-admin="refresh">REFRESH</button>
            <button type="button" class="icon-btn" data-admin="close" aria-label="Close admin panel">✕</button>
          </div>
        </header>
        <div class="admin-tabs" role="tablist">
          ${['pending', 'approved', 'denied'].map((t) => `
            <button type="button" role="tab" aria-selected="${t === tab}" class="${t === tab ? 'active' : ''}" data-tab="${t}">
              ${STATUS_TEXT[t]} <b>${counts[t]}</b>
            </button>`).join('')}
        </div>
        ${error ? `<p class="admin-error" role="alert">${escapeHtml(error)}</p>` : ''}
        <div class="admin-table-wrap">
          ${loading ? '<p class="admin-empty">Loading…</p>' : list.length ? `
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Sign-in</th><th>Requested</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${list.map(rowHtml).join('')}</tbody>
          </table>` : `<p class="admin-empty">No ${STATUS_TEXT[tab].toLowerCase()} testers.</p>`}
        </div>
        <p class="admin-note">Revoke withdraws a decision and puts the tester back in Pending. Changes reach testers' screens immediately.</p>
      </div>`;
  }

  async onAdminClick(e) {
    if (e.target === this.adminPanel) return this.closeAdmin();
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.admin === 'close') return this.closeAdmin();
    if (t.dataset.admin === 'refresh') return this.reloadTesters();
    if (t.dataset.tab) {
      this.admin.tab = t.dataset.tab;
      return this.renderAdmin();
    }
    if (t.dataset.set) {
      const id = t.dataset.user;
      this.admin.busy.add(id);
      this.renderAdmin();
      try {
        const updated = await this.auth.setStatus(id, t.dataset.set);
        const i = this.admin.rows.findIndex((r) => r.user_id === id);
        if (i >= 0) this.admin.rows[i] = updated;
        this.admin.error = '';
      } catch (err) {
        this.admin.error = `Couldn't update: ${err.message}`;
      }
      this.admin.busy.delete(id);
      this.renderAdmin();
    }
  }
}
