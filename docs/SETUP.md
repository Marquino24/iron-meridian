# Iron Meridian: hosting, sign-in and beta setup

A step-by-step guide for a Windows PC, assuming you've never done any of this before. Do the parts in order. Total time: about 1–2 hours, mostly waiting for websites and clicking through forms.

Throughout this guide:

- **Your game address** is `https://marquino24.github.io/iron-meridian/`
- **Your Supabase callback URL** looks like `https://abcdefghijklmnop.supabase.co/auth/v1/callback`. You'll get the real one in Part B, step 6. Every sign-in provider needs it.

> **Keep secrets secret.** You'll create several *client secrets* and a *database password*. They only ever go into the Supabase dashboard (or a password manager). Never paste them into a chat, an email, GitHub, or any file in the game. The only Supabase value that goes into the game is the **publishable key** (also called the *anon public* key). It's designed to be public.

Tip: keep a text file open (for example in Notepad) called `iron-meridian-setup.txt` to paste values into as you go. Delete it at the end, or better, store the secrets in a password manager.

---

## Part A: GitHub repository and GitHub Pages

### A1. Create the repository
1. Go to <https://github.com/new> and sign in.
2. **Repository name:** `iron-meridian`
3. Choose **Public**. Free GitHub Pages needs a public repository.
4. Leave **Add a README**, **.gitignore** and **license** all unticked. The repository must be empty.
5. Click **Create repository**.

### A2. Let Claude push to it
1. Open <https://claude.ai/connect-github> and connect GitHub if asked.
2. If the Claude GitHub App is set to **Only select repositories**, add `iron-meridian` to the list and save.
3. Tell Claude in the chat: *"the repo is ready"*. Claude pushes the game.

### A3. Turn on GitHub Pages (after Claude has pushed)
1. Open `https://github.com/Marquino24/iron-meridian`, then **Settings** (top tab) → **Pages** (left menu).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. **Branch:** `main`, folder **/ (root)**. Click **Save**.
4. Wait 1–2 minutes and refresh. The page shows *"Your site is live at https://marquino24.github.io/iron-meridian/"*.

Until Part D is done, the site opens straight into the game without sign-in.

---

## Part B: Supabase project

### B1. Create an account
1. Go to <https://supabase.com> and click **Start your project**.
2. Choose **Continue with GitHub** (easiest) and approve.

### B2. Create the project
1. Click **New project**. If asked for an organization, create one (any name, **Free** plan).
2. **Project name:** `iron-meridian`
3. **Database password:** click **Generate a password**, then **copy it into your password manager**. You won't need it for this guide, but don't lose it and never share it.
4. **Region:** the one closest to you and your testers.
5. Click **Create new project** and wait about 2 minutes until the dashboard loads.

### B3. Create the beta tables and security rules
1. Open the file `supabase/schema.sql` from the repository on GitHub (`https://github.com/Marquino24/iron-meridian/blob/main/supabase/schema.sql`) and click the **copy raw file** button (two overlapping squares, top right of the file).
2. In Supabase, open **SQL Editor** in the left menu (the `>_` icon), then **+ New query**.
3. Paste the file.
4. Find this line near the top:
   ```sql
   values ('owner_email', lower('owner@example.com'))          -- >>> OWNER <<<
   ```
   Replace `owner@example.com` with **the email of the account you'll sign in with as the owner**. For example, if you'll use **Continue with Google**, use that Google account's email. Keep the quotes.
5. Click **Run** (bottom right) or press **Ctrl+Enter**. You should see **Success. No rows returned**.
   - If Supabase warns about "destructive operations", click **Run this query**. The file only creates things and changes no existing data.

To change the owner later, run this in a new query:
```sql
update private.settings set value = lower('new-email@example.com') where key = 'owner_email';
```

### B4. Get the two public values for the game
1. Click the **Connect** button at the top of the dashboard, or go to **Project Settings** (gear icon) → **API Keys**.
2. Copy the **Project URL**, which looks like `https://abcdefghijklmnop.supabase.co`.
3. Copy the **Publishable key** (starts with `sb_publishable_`). If you only see legacy keys, copy the **anon public** key (starts with `eyJ`).
4. **Do not** copy the **secret** or **service_role** key. Never use those in the game.

### B5. Tell Supabase where the game lives
1. Go to **Authentication** (left menu) → **URL Configuration**.
2. **Site URL:** `https://marquino24.github.io/iron-meridian/` and click **Save**.
3. Under **Redirect URLs**, click **Add URL** and add each of these:
   - `https://marquino24.github.io/iron-meridian/**`
   - `http://localhost:3000/**` (for testing on your own PC; optional)

### B6. Find your callback URL
1. Go to **Authentication** → **Sign In / Providers** (on older dashboards: **Providers**).
2. Click **Google** in the list. The panel shows a **Callback URL (for OAuth)** like `https://abcdefghijklmnop.supabase.co/auth/v1/callback`. Click the copy button and paste it into your notes.
3. This same URL is used for **every** provider below.

---

## Part C: Sign-in providers

The pattern is the same for each provider:

1. Create an "app" on the provider's developer site.
2. Paste **your callback URL** into it.
3. Copy the provider's **Client ID** and **Client Secret**.
4. In Supabase: **Authentication → Sign In / Providers → (provider)**, switch **Enable** on, paste both values, and click **Save**.

You can do them one at a time and in any order. A provider that isn't set up yet shows players the message *"… sign-in isn't switched on yet"*, and nothing breaks.

### C1. Google
1. Go to <https://console.cloud.google.com> and sign in with your Google account. Accept the terms if asked.
2. At the top, click the project picker → **New project**, name it `Iron Meridian`, click **Create**, then select it.
3. In the search bar, type **Google Auth Platform** and open it, then click **Get started**.
   - **App name:** `Iron Meridian`. **User support email:** your email. Click **Next**.
   - **Audience:** **External**. Click **Next**.
   - **Contact information:** your email. Click **Next**, tick the agreement, then **Continue** → **Create**.
4. Left menu → **Branding**:
   - **Application home page:** `https://marquino24.github.io/iron-meridian/`
   - **Privacy policy link:** `https://marquino24.github.io/iron-meridian/privacy.html`
   - **Terms of service link:** `https://marquino24.github.io/iron-meridian/terms.html`
   - **Authorized domains:** add `supabase.co`
   - Click **Save**.
5. Left menu → **Clients** → **+ Create client**:
   - **Application type:** **Web application**. **Name:** `Iron Meridian web`.
   - **Authorized JavaScript origins** → **+ Add URI**: `https://marquino24.github.io`
   - **Authorized redirect URIs** → **+ Add URI**: your Supabase callback URL
   - Click **Create**. A box shows the **Client ID** and **Client secret**. Copy both now.
6. Left menu → **Audience** → under **Publishing status**, click **Publish app** → **Confirm**. While the app is in "Testing", only accounts you list as test users can sign in.
7. In Supabase → **Google**: Enable, paste the Client ID and Client Secret, and click **Save**.

### C2. Discord
1. Go to <https://discord.com/developers/applications> and sign in.
2. Click **New Application**, name it `Iron Meridian`, accept the terms, and click **Create**.
3. Left menu → **OAuth2**.
4. Under **Redirects**, click **Add Redirect**, paste your callback URL, and click **Save Changes**.
5. Copy the **Client ID**. Click **Reset Secret** → **Yes, do it!** and copy the new **Client Secret**.
6. In Supabase → **Discord**: Enable, paste both, and click **Save**.

### C3. Microsoft (Outlook, Hotmail, Xbox and work accounts)
1. Go to <https://portal.azure.com> and sign in with your Microsoft account. If it asks you to create an Azure subscription, you don't need one. App registrations work without it.
2. In the top search bar, type **App registrations** and open it. Click **+ New registration**.
   - **Name:** `Iron Meridian`
   - **Supported account types:** *Accounts in any organizational directory and personal Microsoft accounts*
   - **Redirect URI:** platform **Web**, then paste your callback URL
   - Click **Register**.
3. On the app's **Overview** page, copy the **Application (client) ID**.
4. Left menu → **Certificates & secrets** → **Client secrets** → **+ New client secret**. Description `supabase`, choose the longest expiry (24 months), and click **Add**.
5. Copy the **Value** column right away. It's hidden once you leave the page. Don't copy the "Secret ID".
6. Put a reminder in your calendar a week before the expiry date to make a new secret.
7. In Supabase → **Azure**: Enable, paste the **Application (client) ID** and the secret **Value**. Leave **Azure Tenant URL** empty. Click **Save**.

### C4. GitHub
1. Go to <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
   - **Application name:** `Iron Meridian`
   - **Homepage URL:** `https://marquino24.github.io/iron-meridian/`
   - **Authorization callback URL:** your callback URL
   - Click **Register application**.
2. Copy the **Client ID**. Click **Generate a new client secret** and copy it.
3. In Supabase → **GitHub**: Enable, paste both, and click **Save**.

### C5. Twitch
1. Twitch requires two-factor authentication for developers. If it isn't on yet, go to Twitch → **Settings → Security and Privacy → Two-Factor Authentication** and set it up.
2. Go to <https://dev.twitch.tv/console> → **Applications** → **+ Register Your Application**.
   - **Name:** `Iron Meridian` (must be unique on Twitch; add something if it's taken, like `Iron Meridian Beta`)
   - **OAuth Redirect URLs:** your callback URL
   - **Category:** Game Integration
   - **Client Type:** Confidential
   - Click **Create**.
3. Click **Manage** next to the app. Copy the **Client ID**, click **New Secret** and copy the **Client Secret**.
4. In Supabase → **Twitch**: Enable, paste both, and click **Save**.

### C6. X (Twitter)
1. Go to <https://developer.x.com> and sign in with your X account. Sign up for the **Free** developer tier and describe your use, for example "Sign-in with X for my indie game's closed beta".
2. In the developer portal, open your **Project** → your **App** → **User authentication settings** → **Set up**.
   - **App permissions:** **Read**, and switch on **Request email from users**
   - **Type of App:** **Web App, Automated App or Bot**
   - **Callback URI / Redirect URL:** your callback URL
   - **Website URL:** `https://marquino24.github.io/iron-meridian/`
   - **Terms of service:** `https://marquino24.github.io/iron-meridian/terms.html`
   - **Privacy policy:** `https://marquino24.github.io/iron-meridian/privacy.html`
   - Click **Save**.
3. X shows the **OAuth 2.0 Client ID and Client Secret** once. Copy both. You can regenerate them later under **Keys and tokens**.
4. In Supabase, open **X / Twitter (OAuth 2.0)**. It's a separate entry from the older plain "Twitter". Enable it, paste both, and click **Save**.

### C7. Email magic link
Email sign-in is on by default (**Sign In / Providers → Email**). One important limit applies:

> Supabase's built-in email sender only delivers to members of your Supabase team, and at most about 2 emails per hour. Magic links work for **you** out of the box, but testers won't receive them until you add your own email sender.

To let testers use email links, set up custom SMTP. The simplest way with a Gmail account:
1. Turn on 2-Step Verification for your Google account: <https://myaccount.google.com/security>.
2. Create an app password at <https://myaccount.google.com/apppasswords>. Name it `Supabase`, then copy the 16-letter password.
3. In Supabase: **Authentication → Emails → SMTP Settings**, switch on **Enable custom SMTP**:
   - **Sender email:** your Gmail address. **Sender name:** `Iron Meridian`
   - **Host:** `smtp.gmail.com`. **Port:** `465`
   - **Username:** your full Gmail address. **Password:** the app password
   - Click **Save**.
4. Optional: **Authentication → Rate Limits** to raise the emails-per-hour limit. Gmail allows about 500 per day.

If you'd rather not, the social providers above are enough. Testers can skip the email option.

### C8. Apple
It shows as **Coming soon** and is disabled. It needs a paid Apple Developer account ($99/year). Ask Claude to switch it on once you have one.

---

## Part D: Connect the game to Supabase

Send Claude the two **public** values from B4, the **Project URL** and the **Publishable key**. Sharing them is safe because they're designed to be public. Claude puts them in `js/config.js` and pushes, and the live site then requires sign-in.

Or do it yourself on GitHub: open `js/config.js` in the repository, click the pencil icon (**Edit this file**), and fill in:
```js
export const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_…';
```
Click **Commit changes…** → **Commit changes**. GitHub Pages updates in 1–2 minutes.

## Part E: First sign-in and check
1. Open `https://marquino24.github.io/iron-meridian/` in a normal browser window.
2. Sign in with the account whose email you set as owner in B3. You should go straight to the era screen, with an **ADMIN** button at the top right.
3. Open a **private/incognito window**, sign in with a *different* account, and click **Request beta access**. You'll see *Pending approval*.
4. In your normal window, click **ADMIN**. The request appears under **Pending**. Click **Approve** and watch the incognito window open the game by itself.

If something doesn't work, the most common causes are:
- **"Redirect URL not allowed" / you land on the wrong page:** check B5. The address must match exactly, including `/iron-meridian/`.
- **Provider shows an error page:** the callback URL pasted at the provider must be exactly the one from B6.
- **No Admin button:** the email in B3 must match the email of the account you signed in with, and that account's email must be verified with the provider.
