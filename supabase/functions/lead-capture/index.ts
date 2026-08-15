// Public website lead-capture endpoint. Accepts JSON (or form-encoded) body
// with flexible field names since the exact website form fields aren't
// finalized yet — adjust the FIELD_MAP aliases below once confirmed.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    if (obj[k]) return String(obj[k])
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })

  const contentType = req.headers.get('content-type') ?? ''
  let body: Record<string, unknown> = {}
  if (contentType.includes('application/json')) {
    body = await req.json()
  } else {
    const form = await req.formData()
    for (const [k, v] of form.entries()) body[k] = v
  }

  const name = pick(body, ['name', 'full_name', 'fullName', 'customer_name'])
  if (!name) {
    return new Response(JSON.stringify({ error: 'name is required' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // This endpoint is unauthenticated by design (public website form), so
  // there's no user membership to derive org context from. Looked up from
  // the organizations table rather than a hardcoded literal — single-tenant
  // today, and the seam where per-form routing (e.g. an org-scoped API key)
  // would slot in once a second org exists.
  const { data: org, error: orgError } = await supabase.from('organizations').select('id').limit(1).maybeSingle()
  if (orgError || !org) {
    return new Response(JSON.stringify({ error: 'no organization configured' }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      organization_id: org.id,
      name,
      company: pick(body, ['company', 'company_name', 'organisation', 'organization']),
      email: pick(body, ['email', 'email_address']),
      phone: pick(body, ['phone', 'mobile', 'contact', 'phone_number']),
      source: 'website',
      score: 20,
      raw_payload: body,
    })
    .select()
    .single()

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const n8nWebhook = Deno.env.get('N8N_NEW_LEAD_WEBHOOK_URL')
  if (n8nWebhook) {
    fetch(n8nWebhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lead) }).catch(() => {})
  }

  return new Response(JSON.stringify({ ok: true, id: lead.id }), { status: 200, headers: { ...CORS, 'content-type': 'application/json' } })
})
