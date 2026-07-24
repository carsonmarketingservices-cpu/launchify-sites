# Full Setup — Complete Stack

Everything below is real, working code. Nothing in this list is a
placeholder or a "coming soon" — this doc is just the (unavoidable)
list of accounts, keys, and one-time steps needed to turn it on.

## What's real now

- Real AI-generated HTML page + 3 real images per business
- Real accounts (email/password + Google OAuth)
- Save, edit (description + raw HTML), delete, publish/unpublish
- A real dashboard (`dashboard.html`) listing all of a user's saved sites
- Real image storage — saved sites get real hosted image URLs, not giant embedded base64
- Real custom domains — a user can point their own domain at a specific published site
- A real contact form that sends actual email via Resend

## 1. Frontend config (two files, same values)

In **both** `index.html` and `dashboard.html`, find:
```js
const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```
Fill in your real Launchify Supabase project's URL and anon/public key
(Project Settings → API). These are meant to be public — fine to live in
client-side files.

## 2. Database

Supabase SQL Editor → run `supabase/schema.sql`. This creates the
`sites` table (with `custom_domain`) and its RLS policies, plus storage
policies for the `site-images` bucket.

**Before running it**, create the bucket first: Supabase dashboard →
Storage → New bucket → name exactly `site-images` → toggle **Public** on.

## 3. Auth

Supabase dashboard → Authentication → Providers → Google → enable, add a
**new** Google OAuth client (don't reuse Never Worry Wealth's — redirect
URLs differ). Authentication → URL Configuration → add your real domain
to Redirect URLs once you have one.

## 4. Netlify environment variables

| Key | Value | Used by |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic key | page + image-prompt generation |
| `OPENAI_API_KEY` | OpenAI key | 3-image gallery |
| `SUPABASE_URL` | project URL | most functions + the edge function |
| `SUPABASE_ANON_KEY` | anon key | verifying user tokens, public reads |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key | all real database writes — never in frontend code |
| `RESEND_API_KEY` | Resend key | contact form |
| `RESEND_FROM` | e.g. `Launchify Sites <hello@launchifysites.com>` | contact form sender |
| `RESEND_TO` | e.g. `hello@launchifysites.com` | where submissions land |
| `NETLIFY_AUTH_TOKEN` | a Netlify personal access token (User settings → Applications → New access token) | registering custom domains |
| `NETLIFY_SITE_ID` | this site's ID (Site configuration → General → Site details) | registering custom domains |

Make sure env vars are available to **Edge Functions** too, not just
regular Functions — Netlify sometimes scopes these separately; check the
dashboard when adding `SUPABASE_URL`/`SUPABASE_ANON_KEY`.

Redeploy after adding these.

## 5. Resend domain verification

Resend dashboard → Domains → verify `launchifysites.com` (or whichever
domain `hello@` is on). Sends fail until this is done.

## 6. OpenAI org verification

OpenAI dashboard → Settings → Organization → Verification. Required for
the GPT Image models used in the gallery.

## 7. Custom domains — how it actually works, end to end

1. A logged-in user adds `theircoffeeshop.com` on the dashboard
2. `custom-domain.js` calls the Netlify API to add that domain as a
   "domain alias" on your site — the step that makes Netlify willing to
   accept traffic for that domain at all
3. The user still has to go to their own domain's DNS settings and add a
   CNAME (or A record) pointing at your Netlify site — no function can
   do that part for them, same as Wix/Framer/Webflow
4. Once DNS propagates, Netlify auto-provisions SSL — a few minutes to
   longer depending on DNS TTLs
5. The edge function (`domain-router.js`) recognizes requests arriving
   on that domain and serves the matching site's HTML

If a customer domain "doesn't work" right after setup, the most common
cause is step 3 not being done yet, not a bug in this code.

## 8. Netlify function timeout (unchanged risk)

One Claude call + 3 parallel OpenAI image calls can approach 10 seconds.
Check your Netlify plan's function timeout; consider fewer images if you
see real-world timeouts.

---

## Security posture — intentionally still in place

- **Sandboxed preview** — the unsaved live preview still renders in a
  script-blocked iframe. Once published, a site is served as a real page
  (that's the point of publishing), which is why the script/form-stripping
  in `generate-website.js` matters — it's the only thing standing between
  visitor input and what ends up on a real, public page.
- **Row-level security** — every table read/write is scoped to the
  authenticated user by Postgres itself, not just application logic.
- **Service role key** never leaves the server-side functions.
- **Input validation and length limits** on every function.
- **Content restrictions in the image prompts** (no real people, no
  copyrighted characters/logos) — the prompts are shaped by whatever a
  visitor typed in.

## Still not built (genuinely out of scope, not hidden)

- Rate limiting / abuse protection per visitor — worth adding via
  Netlify traffic rules before real public launch, given each click now
  costs a Claude call + 3 image calls
- A visual drag-and-drop editor — the current editor is a real raw-HTML
  textarea, not a WYSIWYG builder
- Billing/Stripe wiring for the pricing tiers themselves
- Orphaned image cleanup in Storage after a site is deleted or an image regenerated
