# Deploying to production hosting

No token or credential sharing needed — connect via GitHub OAuth in the
hosting provider's own dashboard, and it deploys automatically on every
push to `main`.

## Option A: Vercel (recommended)

1. Go to vercel.com, sign in with GitHub (or create an account).
2. "Add New… → Project", pick `tmanish2015/insignia-control-centre` from
   the repo list. If it's not listed, click "Adjust GitHub App Permissions"
   and grant Vercel access to this repo.
3. Vercel auto-detects Vite (`vercel.json` in this repo also pins the
   build command/output dir explicitly, so detection isn't required).
4. Before clicking Deploy, add two environment variables (Settings →
   Environment Variables, or the form on the import screen):
   - `VITE_SUPABASE_URL` = `https://dvcfhxmktpaeikysdlrg.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the anon key from `.env.local` (safe to
     expose client-side — RLS is what actually protects data)
5. Click Deploy. Every future push to `main` redeploys automatically.

## Option B: Netlify

1. app.netlify.com → "Add new site" → "Import an existing project" →
   GitHub → same repo.
2. `netlify.toml` in this repo already sets the build command/publish dir
   and the SPA redirect rule (without it, refreshing on a route like
   `/customers/:id` would 404).
3. Site settings → Environment variables → add the same two
   `VITE_SUPABASE_*` values as above.
4. Deploy. Same auto-deploy-on-push behavior as Vercel.

## What this repo does NOT need set for hosting

Razorpay/Meta/Google/n8n secrets are edge-function secrets (set via
`supabase secrets set`, not a hosting env var) and none of those
integrations are live yet — see `src/pages/Integrations.tsx` / the app's
Integrations page for current status. The frontend build only needs the
two `VITE_SUPABASE_*` values above.

## After connecting

Come back and share the resulting URL (`https://insignia-control-centre.vercel.app`
or your custom domain) so it can be recorded and, later, wired into
`FRONTEND_URL` / `META_REDIRECT_URI` for the edge functions once those
integrations are turned on.
