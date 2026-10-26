/**
 * config.js — Public settings for sign-in and the beta gate.
 *
 * Only PUBLIC values belong here. The publishable key is designed to be
 * shipped to browsers: what it can do is limited by the row-level security
 * policies in docs/supabase-setup.sql. Never put a secret key (sb_secret_…),
 * the service_role key, provider client secrets or the database password in
 * any file of this repository.
 */

/** Supabase project URL (Supabase → Project Settings → API). */
export const SUPABASE_URL = 'https://kzdixrmlqcedgiqsrsdy.supabase.co';

/** The PUBLISHABLE key (sb_publishable_…). Safe in client code. Never the secret key. */
export const SUPABASE_ANON_KEY = 'sb_publishable_zMloPRCzrr45_irjARhcRQ_6NtetEZE';

/** Where the real game lives. Sign-in providers send players back here. */
export const SITE_URL = 'https://marquino24.github.io/iron-meridian/';

// =============================================================================
// >>> OWNERS <<<  Edit this list to add or remove owners.
//
// Owners are always let in and get the Admin panel (approve / deny / revoke
// testers). An owner is matched by the CONFIRMED email of whatever account
// they sign in with (Google, Discord, GitHub, Twitch or an email link).
//
// The database decides who is an owner, so after editing this list, run the
// matching lines from docs/supabase-setup.sql (section "Owners") in the
// Supabase SQL editor too. `npm test` fails if the two lists differ.
// =============================================================================
export const OWNER_EMAILS = [
  'marcoferreirag3@gmail.com',
];

/** Sign-in options in the order they appear. `id` is the Supabase provider name. */
export const PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'discord', label: 'Discord' },
  { id: 'github', label: 'GitHub' },
  { id: 'twitch', label: 'Twitch' },
];

/** Vendored @supabase/supabase-js build (no third-party CDN at runtime). */
export const SUPABASE_JS = 'vendor/supabase-js-2.117.3.js';
