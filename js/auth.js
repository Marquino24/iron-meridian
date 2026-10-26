/**
 * auth.js — Supabase sign-in and beta-access data.
 *
 * Wraps the Supabase client so the rest of the game never talks to it
 * directly. Security does not depend on this file: the database enforces
 * who can read and change what (docs/supabase-setup.sql).
 *
 * The client library is loaded on demand from vendor/, so builds without
 * sign-in (dev preview) never fetch it.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JS, SITE_URL } from './config.js';

/** Hosts where the game runs from a developer's machine. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

/**
 * Which sign-in this page uses:
 *   'real'  Supabase sign-in. Always on the real site (github.io) and any
 *           other host: there is no way to get demo sign-in there.
 *   'demo'  a fake owner in this browser, for the claude.ai dev preview (the
 *           bundled build sets __IM_PREVIEW__) and local development
 *           (localhost or a file:// page). Add ?auth=real on localhost to try
 *           the real flow (needs localhost in Supabase's redirect URLs).
 */
export function authMode() {
  if (typeof window === 'undefined') return 'real';
  if (window.__IM_SUPABASE_FACTORY__) return 'real'; // automated tests with a fake server
  if (window.__IM_PREVIEW__) return 'demo';
  let forceReal = false;
  try { forceReal = new URLSearchParams(location.search).get('auth') === 'real'; } catch { /* ignore */ }
  if (LOCAL_HOSTS.has(location.hostname) && !forceReal) return 'demo';
  return 'real';
}

/** True when this page requires real sign-in. */
export function authEnabled() { return authMode() === 'real'; }

/** True when the real-sign-in settings are filled in. */
export const authConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * Where providers send the player back to. On the real site always SITE_URL
 * (https://marquino24.github.io/iron-meridian/, allowed in Supabase), so a
 * visit to …/index.html or with ?era=… still returns to the canonical page.
 * Elsewhere (local testing with ?auth=real): this page, without query or hash.
 */
export function redirectUrl() {
  try {
    const site = new URL(SITE_URL);
    if (location.host === site.host && location.pathname.startsWith(site.pathname.replace(/\/$/, ''))) return SITE_URL;
  } catch { /* ignore */ }
  return `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;
}

export class AuthService {
  constructor() {
    this.client = null;
    this.session = null;
    this.listeners = new Set();
    this.channels = new Set();
  }

  /** Create the client and restore a remembered session (if any). */
  async init() {
    // Tests can inject a fake client; production loads the vendored library.
    let factory = window.__IM_SUPABASE_FACTORY__;
    if (!factory && !authConfigured()) throw new Error('sign-in is not configured (js/config.js).');
    if (!factory) {
      if (!window.supabase?.createClient) await loadScript(SUPABASE_JS);
      factory = window.supabase.createClient;
    }
    this.client = factory(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    this.session = data.session;
    this.client.auth.onAuthStateChange((event, session) => {
      this.session = session;
      for (const fn of this.listeners) fn(event, session);
    });
    // Remove ?code=… (and any error params) left by the sign-in redirect.
    try {
      const url = new URL(location.href);
      let dirty = false;
      for (const k of ['code', 'error', 'error_code', 'error_description']) {
        if (url.searchParams.has(k)) { url.searchParams.delete(k); dirty = true; }
      }
      if (url.hash.includes('access_token') || url.hash.includes('error')) { url.hash = ''; dirty = true; }
      if (dirty) history.replaceState(null, '', url);
    } catch { /* ignore */ }
    return this.session;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get user() { return this.session?.user ?? null; }

  /** Provider the current user signed in with ("google", "email", …). */
  get provider() { return this.user?.app_metadata?.provider ?? 'email'; }

  get displayName() {
    const m = this.user?.user_metadata ?? {};
    return m.full_name || m.name || m.user_name || m.preferred_username || this.user?.email?.split('@')[0] || 'Commander';
  }

  // --- Sign-in ---------------------------------------------------------------

  async signInWithProvider(provider, scopes) {
    const { error } = await this.client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: redirectUrl(), ...(scopes ? { scopes } : {}) },
    });
    if (error) throw error;
    // The browser now navigates to the provider.
  }

  async sendMagicLink(email) {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectUrl(), shouldCreateUser: true },
    });
    if (error) throw error;
  }

  async signOut() {
    this.unwatchAll();
    await this.client.auth.signOut();
  }

  // --- Beta access ------------------------------------------------------------

  async isOwner() {
    const { data, error } = await this.client.rpc('is_owner');
    if (error) throw error;
    return data === true;
  }

  /** The signed-in user's beta row, or null if they haven't requested access. */
  async myBetaRow() {
    const { data, error } = await this.client
      .from('beta_users')
      .select('*')
      .eq('user_id', this.user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Create the request. The server fills in name, email, provider and status. */
  async requestAccess() {
    const { error } = await this.client.from('beta_users').insert({ user_id: this.user.id, provider: this.provider });
    if (error && error.code !== '23505') throw error; // 23505: already requested
    return this.myBetaRow();
  }

  /** Live updates for the signed-in user's own row. Returns an unsubscribe function. */
  watchMyRow(onRow) {
    const ch = this.client
      .channel(`beta-self-${this.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'beta_users', filter: `user_id=eq.${this.user.id}` }, (payload) => onRow(payload.new))
      .subscribe();
    this.channels.add(ch);
    return () => { this.client.removeChannel(ch); this.channels.delete(ch); };
  }

  // --- Admin (owner only; the database refuses everyone else) -------------------

  async listTesters() {
    const { data, error } = await this.client
      .from('beta_users')
      .select('*')
      .order('requested_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async setStatus(userId, status) {
    const { data, error } = await this.client
      .from('beta_users')
      .update({ status })
      .eq('user_id', userId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Not allowed (owner only).');
    return data;
  }

  watchAll(onChange) {
    const ch = this.client
      .channel('beta-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'beta_users' }, onChange)
      .subscribe();
    this.channels.add(ch);
    return () => { this.client.removeChannel(ch); this.channels.delete(ch); };
  }

  unwatchAll() {
    for (const ch of this.channels) this.client.removeChannel(ch);
    this.channels.clear();
  }
}

/**
 * Demo sign-in for the claude.ai dev preview and local development (see
 * authMode). It fakes an approved owner account in this browser only, so the
 * whole flow (menu, admin panel) can be tried. It has no backend and no
 * powers, and the real site (github.io) never uses it or shows its button.
 */
export class DemoAuthService {
  constructor() {
    this.demo = true;
    this.session = null;
    this.listeners = new Set();
    this.rows = [
      { user_id: 'demo-owner', provider: 'demo', display_name: 'Demo Commander', email: 'demo@iron-meridian.test', status: 'approved', requested_at: new Date(Date.now() - 864e5 * 3).toISOString() },
      { user_id: 'demo-1', provider: 'google', display_name: '[Sample] Ada Lovelace', email: 'ada@example.com', status: 'pending', requested_at: new Date(Date.now() - 36e5 * 5).toISOString() },
      { user_id: 'demo-2', provider: 'discord', display_name: '[Sample] Basil Hart', email: 'basil@example.com', status: 'pending', requested_at: new Date(Date.now() - 36e5 * 2).toISOString() },
      { user_id: 'demo-3', provider: 'github', display_name: '[Sample] Chen Wei', email: 'chen@example.com', status: 'approved', requested_at: new Date(Date.now() - 864e5 * 2).toISOString() },
      { user_id: 'demo-4', provider: 'twitch', display_name: '[Sample] Dana Ruiz', email: 'dana@example.com', status: 'denied', requested_at: new Date(Date.now() - 864e5 * 4).toISOString() },
    ];
  }

  async init() {
    try { if (localStorage.getItem('im:demo-session') === '1') this.session = this.fakeSession(); } catch { /* ignore */ }
    return this.session;
  }

  fakeSession() {
    return { user: { id: 'demo-owner', email: 'demo@iron-meridian.test', app_metadata: { provider: 'demo' }, user_metadata: { full_name: 'Demo Commander' } } };
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  get user() { return this.session?.user ?? null; }
  get provider() { return 'demo'; }
  get displayName() { return 'Demo Commander'; }

  async signInDemo() {
    this.session = this.fakeSession();
    try { localStorage.setItem('im:demo-session', '1'); } catch { /* ignore */ }
  }

  async signInWithProvider() { throw new Error('Real sign-in is off in this preview. Use Demo sign-in.'); }
  async sendMagicLink() { throw new Error('Real sign-in is off in this preview. Use Demo sign-in.'); }

  async signOut() {
    this.session = null;
    try { localStorage.removeItem('im:demo-session'); } catch { /* ignore */ }
  }

  async isOwner() { return !!this.session; }
  async myBetaRow() { return this.rows[0]; }
  async requestAccess() { return this.rows[0]; }
  watchMyRow() { return () => {}; }
  async listTesters() { return this.rows.map((r) => ({ ...r })); }
  async setStatus(userId, status) {
    const r = this.rows.find((x) => x.user_id === userId);
    r.status = status;
    return { ...r };
  }
  watchAll() { return () => {}; }
  unwatchAll() {}
}
