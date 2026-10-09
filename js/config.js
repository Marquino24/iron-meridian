/**
 * config.js — Public settings for sign-in and the beta gate.
 *
 * Only PUBLIC values belong here. The anon key is designed to be shipped to
 * browsers: what it can do is limited by the row-level security policies in
 * supabase/schema.sql. Never put the service_role key, provider client
 * secrets or the database password in any frontend file.
 *
 * Leave SUPABASE_URL empty to run without sign-in (local development and the
 * claude.ai dev preview).
 */

/** Project URL, e.g. 'https://abcdefghijklmnop.supabase.co' (Supabase → Project Settings → API). */
export const SUPABASE_URL = '';

/**
 * The PUBLIC key: the "Publishable key" (starts with sb_publishable_) from
 * Supabase → Project Settings → API Keys, or the legacy "anon public" key
 * (starts with eyJ). Never the "secret" or "service_role" key.
 */
export const SUPABASE_ANON_KEY = '';

/**
 * Sign-in options in the order they appear. `id` is the Supabase provider name.
 * Set `enabled: false` to show a provider as "Coming soon".
 */
export const PROVIDERS = [
  { id: 'google', label: 'Google', enabled: true },
  { id: 'discord', label: 'Discord', enabled: true },
  { id: 'azure', label: 'Microsoft', enabled: true, scopes: 'email' },
  { id: 'github', label: 'GitHub', enabled: true },
  { id: 'twitch', label: 'Twitch', enabled: true },
  { id: 'x', label: 'X', enabled: true },
  { id: 'apple', label: 'Apple', enabled: false },
];

/** Vendored @supabase/supabase-js build (no third-party CDN at runtime). */
export const SUPABASE_JS = 'vendor/supabase-js-2.117.3.js';
