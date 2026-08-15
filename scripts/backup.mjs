#!/usr/bin/env node
// Logical backup of every business table to timestamped JSON files.
// Does NOT cover auth.users / auth.identities — those are Supabase Auth's
// own data and are exported separately via the Auth admin API or the
// Supabase dashboard (Authentication -> Users -> Export).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup.mjs
//
// Never hardcode the service role key here or anywhere else - it must come
// from the environment, and is never committed (see .gitignore for backups/).

import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
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
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.')
  process.exit(1)
}

const supabase = createClient(url, key)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dir = join('backups', stamp)
mkdirSync(dir, { recursive: true })

let totalRows = 0
for (const table of TABLES) {
  const { data, error } = await supabase.from(table).select('*')
  if (error) {
    console.error(`FAILED backing up ${table}: ${error.message}`)
    process.exit(1)
  }
  writeFileSync(join(dir, `${table}.json`), JSON.stringify(data, null, 2))
  totalRows += data.length
  console.log(`${table}: ${data.length} rows`)
}

console.log(`\nBackup complete: ${dir} (${totalRows} rows across ${TABLES.length} tables)`)
