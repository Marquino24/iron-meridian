# Iron Meridian: going live (GitHub Pages + Supabase)

- **The game:** <https://marquino24.github.io/iron-meridian/> (GitHub Pages, from the `main` branch of `marquino24/iron-meridian`)
- **Sign-in and beta list:** Supabase project `kzdixrmlqcedgiqsrsdy`
- **Dev preview:** the claude.ai artifact (demo sign-in, sample testers; never real accounts)

> **Keep secrets secret.** Provider client secrets, the Supabase **secret** key and the database password only ever go into the Supabase dashboard or a password manager — never into this repository, a chat or an email. The game only contains the **publishable** key (`sb_publishable_…`), which is designed to be public. `npm test` fails if a secret key is committed.

## What's already set up

Checked on 26 Oct 2026 against the live project:

- Google, Discord, GitHub and Twitch sign-in are switched on, and each sends players back to `https://marquino24.github.io/iron-meridian/`. Microsoft, Apple and X are off and not offered in the game.
- Email magic links are on.
- The game's config (`js/config.js`) has the project URL and the publishable key.

## 1. Create the beta table (once)

1. Open `docs/supabase-setup.sql` on GitHub: <https://github.com/Marquino24/iron-meridian/blob/main/docs/supabase-setup.sql>, then click **Copy raw file** (two squares, top right of the file).
2. Supabase → **SQL Editor** → **+ New query** → paste → **Run**. You should see *Success. No rows returned*. If Supabase warns about destructive operations, click **Run this query**: the script only creates things and resets the owner list. It never deletes testers.

The script is written for this project's settings: new tables aren't exposed to the API automatically, so it grants exactly what the game needs, and it turns row-level security on. In effect:
- a signed-in player can create their **own** row (always *pending*) and read their own status;
- owners can read every row and change status;
- nobody else can read other people's rows or change any status; signed-out visitors can't read anything.

Running it again is safe.

## 2. Turn on GitHub Pages (once)

Repository **Settings → Pages**:

| Setting | Value |
|---|---|
| **Build and deployment → Source** | **Deploy from a branch** |
| **Branch** | `main` |
| **Folder** | `/ (root)` |

Click **Save**. After 1–2 minutes the page says *"Your site is live at https://marquino24.github.io/iron-meridian/"*. Every push to `main` redeploys it within a couple of minutes.

The repository needs to be **public** for Pages on a free GitHub plan. Leave **Custom domain** empty and keep **Enforce HTTPS** ticked. Nothing needs building: the game runs straight from the repository files (the `.nojekyll` file tells Pages to serve them as they are).

## 3. Owners

Owners are always let in and get the **Admin** panel to approve, deny or revoke testers. An owner is matched by the **confirmed email** of whatever account they sign in with (Google, Discord, GitHub, Twitch or an email link). For example, if your Discord account uses marcoferreirag3@gmail.com, you're the owner through Discord too.

The list lives in two places that must match (`npm test` checks this):
1. `js/config.js`, the `OWNER_EMAILS` list marked `>>> OWNERS <<<`;
2. `docs/supabase-setup.sql`, the `values` list marked `>>> EDIT THIS LIST <<<`. **The database copy is the one that grants power.**

To add or remove an owner: edit both lists, commit, and run the SQL script again in the SQL editor.

## 4. Email links: low limits

Supabase's built-in email sender only allows a few emails per hour, and it may only deliver to members of your Supabase team. The sign-in screen tells players to use Discord or Google if the email doesn't arrive.

To make email links reliable for testers, add your own sender: Supabase → **Authentication → Emails → SMTP Settings** → **Enable custom SMTP**. With a Gmail account:
1. Turn on 2-Step Verification (<https://myaccount.google.com/security>), then create an app password at <https://myaccount.google.com/apppasswords> (name it `Supabase`).
2. Sender email: your Gmail address. Sender name: `Iron Meridian`. Host `smtp.gmail.com`, port `465`, username: your full Gmail address, password: the app password. **Save**.
3. Optional: **Authentication → Rate Limits** → raise the emails-per-hour limit (Gmail allows about 500 a day).

## 5. Troubleshooting

- **"The beta database isn't set up yet"** after signing in: do step 1.
- **"Redirect URL not allowed", or you land on the wrong page:** Supabase → **Authentication → URL Configuration** must list `https://marquino24.github.io/iron-meridian/` as the **Site URL** and `https://marquino24.github.io/iron-meridian/**` under **Redirect URLs**.
- **A provider shows its own error page:** the callback URL in that provider's developer settings must be `https://kzdixrmlqcedgiqsrsdy.supabase.co/auth/v1/callback`.
- **No Admin button:** your account's email must be on the owner list (step 3) and confirmed with the provider. Check under Supabase → **Authentication → Users**: the email column shows the address the game sees.
- **The site shows a 404:** check step 2, and that the push reached `main`.

## Local development

Run `python3 -m http.server 3000` in the repository folder and open <http://localhost:3000/>. On localhost the game uses the demo sign-in (a fake owner in your browser), like the claude.ai preview. To try the real sign-in locally, open <http://localhost:3000/?auth=real>; Supabase must also list `http://localhost:3000/**` under Redirect URLs for that.

The real site never offers the demo: `js/auth.js` only allows it for the bundled preview (`dist/`, which sets `__IM_PREVIEW__`) and for localhost.

## Tests for this setup

- `npm test`: checks for committed secrets and that the owner lists match (`tools/check-config.mjs`).
- `npm run test:policies`: runs `docs/supabase-setup.sql` on a throwaway local PostgreSQL 16 database (twice) and checks every rule above as different users (`supabase/test/`).
- `node tools/e2e/pages.test.mjs`: serves the repository exactly as GitHub Pages will, at `https://marquino24.github.io/iron-meridian/`, against the real Supabase project. It checks there's no demo sign-in, that assets load under `/iron-meridian/`, and that each provider button reaches Supabase and the provider's login page with the right return address.
- `node tools/e2e/launcher.test.mjs`: the whole sign-in → pending → approved / denied → admin flow against a fake Supabase.
