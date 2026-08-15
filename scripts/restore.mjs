#!/usr/bin/env node
// Restores a backup produced by scripts/backup.mjs. Upserts by id, so it's
// safe to re-run against a partially-restored target. Table order matches
// the FK dependency chain (organizations first, tasks/audit_log last).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore.mjs backups/<timestamp>

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TABLES = [
  'organizations',
  'profiles',
  'customers',
  'plans',
  'subscriptions',
  'invoices',
  'payment_events',
  'leads',
  'lead_activities',
  'campaigns',
  'campaign_posts',
  'post_metrics',
  'social_accounts',
  'opportunities',
  'tasks',
  'audit_log',
  'client_error_log',
]

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const dir = process.argv[2]

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.')
  process.exit(1)
}
if (!dir) {
  console.error('Usage: node scripts/restore.mjs backups/<timestamp>')
  process.exit(1)
}

const supabase = createClient(url, key)

for (const table of TABLES) {
  const file = join(dir, `${table}.json`)
  if (!existsSync(file)) {
    console.log(`${table}: no backup file, skipping`)
    continue
  }
  const rows = JSON.parse(readFileSync(file, 'utf8'))
  if (rows.length === 0) {
    console.log(`${table}: 0 rows, skipping`)
    continue
  }
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' })
  if (error) {
    console.error(`FAILED restoring ${table}: ${error.message}`)
    process.exit(1)
  }
  console.log(`${table}: restored ${rows.length} rows`)
}

console.log('\nRestore complete.')
