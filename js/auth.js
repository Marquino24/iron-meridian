/**
 * auth.js — Supabase sign-in and beta-access data.
 *
 * Wraps the Supabase client so the rest of the game never talks to it
 * directly. Security does not depend on this file: the database enforces
 * who can read and change what (supabase/schema.sql).
 *
 * The client library is loaded on demand from vendor/, so builds without
 * sign-in (dev preview) never fetch it.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JS } from './config.js';

/** True when this build should require sign-in. */
export function authEnabled() {
  if (typeof window !== 'undefined' && window.__IM_PREVIEW__) return false;
  if (typeof window !== 'undefined' && window.__IM_SUPABASE_FACTORY__) return true; // automated tests
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

/** Where providers send the player back to: this page, without query or hash. */
export function redirectUrl() {
  return `${location.origin}${location.pathname}`;
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
