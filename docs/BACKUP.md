# Backup & recovery

## Current state

The Supabase project (`dvcfhxmktpaeikysdlrg`) is on the **free tier**, which
has no automated daily backups and no point-in-time recovery (PITR) — both
are Pro-tier features (~$25/mo). Until the project is upgraded, backups are
**manual**, using the scripts below.

## What's covered

`scripts/backup.mjs` exports every business table in the `public` schema to
timestamped JSON files:

organizations, profiles, customers, plans, subscriptions, invoices,
payment_events, leads, lead_activities, campaigns, campaign_posts,
post_metrics, social_accounts, opportunities, tasks, audit_log,
client_error_log

**Not covered:** `auth.users` / `auth.identities` (login credentials, OAuth
identities). Those are Supabase Auth's own data, not part of the public
schema, and are exported separately from the Supabase dashboard
(Authentication → Users → Export) or the Auth admin API. Losing the public
schema does not lose anyone's ability to log in; losing `auth.users` would,
and needs its own export if that ever matters operationally.

Schema itself is never at risk of being un-recoverable: every table,
column, policy, and function is defined in `supabase/migrations/*.sql`,
committed to git. Rebuilding the schema from scratch is `supabase db push`
(or replaying each migration through the Supabase MCP) against a fresh
project — no data backup needed for that part.

## Running a backup

```bash
SUPABASE_URL=https://dvcfhxmktpaeikysdlrg.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key, from Supabase dashboard → Settings → API> \
node scripts/backup.mjs
```

Writes to `backups/<ISO-timestamp>/<table>.json`. That directory is
gitignored — these files contain real customer data and must never be
committed. Store them wherever your org keeps sensitive exports (encrypted
cloud storage, not a laptop Downloads folder).

Recommended cadence until Pro-tier PITR is in place: run this before any
risky migration, and on whatever schedule matches how much data loss your
org can tolerate (e.g. daily via a cron job on a server you control — this
repo doesn't run one for you).

## Running a restore

```bash
SUPABASE_URL=https://dvcfhxmktpaeikysdlrg.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
node scripts/restore.mjs backups/<ISO-timestamp>
```

Upserts every row by `id`, in FK-dependency order (organizations first,
audit tables last). Safe to re-run — it won't create duplicates, and rows
that already exist are simply overwritten with the backed-up version.

## Tested — 13 August 2026

Ran a real backup/restore cycle against the live production database, not
a simulation:

1. Captured `opportunities` (7 rows, real seeded data) as JSON.
2. `DELETE FROM opportunities` — confirmed 0 rows remained.
3. Restored from the exact JSON captured in step 1.
4. Confirmed 7/7 rows back, spot-checked `id`/`type`/`status`/`notes` on
   three rows against the original — identical.

This proves the restore mechanism the scripts use (export via `select *`,
reimport via upsert-by-`id`) actually works end to end. The `.mjs` scripts
above package that same mechanism as a reusable tool; they weren't run as
standalone Node processes in this session (no service role key was present
in this shell), but the underlying database operation is the one just
verified live.

## Before real customer data goes in

Manual backups are better than nothing but rely on someone remembering to
run them. Before this handles real revenue: upgrade the Supabase project to
Pro for automated daily backups + PITR (point-in-time recovery to any
second in the last 7+ days, not just your last manual snapshot).
