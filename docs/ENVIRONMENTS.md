# Environments

## Current state (13 August 2026)

There is **one** Supabase project (`dvcfhxmktpaeikysdlrg`) and it currently
serves as both "the place demo data lives" and "the place real data would
land." True environment isolation (separate database per environment) is
blocked right now:

- The org's Supabase free tier allows 2 projects; both are already used by
  other apps in this org, not this one.
- Supabase branching (which would give this project its own throwaway
  staging database) requires the **Pro plan** — attempted and confirmed
  blocked on the free tier (not just a cost question, a hard plan gate).

Until one of those is resolved, the interim safeguard is the `is_demo`
column added in Production Hardening Batch 2: every row in every business
table is flagged `is_demo = true` (seed data) or `false` (created through
the real app by a real user). Demo and real data share a database today,
but they're never ambiguous — `is_demo = false` is always the real dataset,
and it's a one-line filter away from being the *only* dataset shown, or the
only dataset kept when the demo data is eventually purged.

## Getting real separation

Either of these unblocks it:

1. **Upgrade the Supabase org to Pro** (~$25/mo, also unlocks automated
   backups — see `docs/BACKUP.md`). Then `supabase branches create staging`
   (or the equivalent MCP `create_branch` call) gives a real second
   database, seeded from the same migrations, with zero production data.
2. **Free up a project slot** — delete or pause one of the org's other two
   free-tier projects, then create a dedicated `insignia-staging` project
   the normal way.

Either path, the promotion flow once staging exists:

- Migrations are applied to staging first (`supabase/migrations/*.sql`,
  already git-tracked and already the source of truth).
- Verify against staging.
- Apply the same migration to production.
- Never write a migration directly against production without having run
  it against staging first, once staging exists.

## Environment variables per environment

The frontend takes exactly two env vars (`src/lib/supabase.ts`):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon/publishable key>
```

Both are safe to expose client-side by design (RLS is what actually
protects data, not keeping the anon key secret). Once staging exists, each
environment gets its own `.env` file (`.env.production`, `.env.staging`,
`.env.development` — all already covered by the `*.local`/gitignore
pattern if named `.env.*.local`) pointing at that environment's project
URL/anon key. Never share an anon key across environments — it's how a
staging build could accidentally read/write production data.

Edge function secrets (`RAZORPAY_WEBHOOK_SECRET`, `META_APP_ID`,
`META_APP_SECRET`, `META_REDIRECT_URI`, `FRONTEND_URL`,
`N8N_NEW_LEAD_WEBHOOK_URL`) are set per-project via
`supabase secrets set`, so they're naturally environment-scoped once a
second project exists — staging gets its own Razorpay/Meta test
credentials, production gets the real ones, and neither can see the
other's.
