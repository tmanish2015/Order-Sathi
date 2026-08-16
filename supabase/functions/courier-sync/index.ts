// Pulls live tracking status from a 3PL/courier API and updates shipments.
// Not wired to any real courier yet — every courier (Delhivery, Shiprocket,
// Bluedart, ...) has its own API shape and auth, so this is a skeleton to
// fill in once you pick one and have API credentials, not a working
// integration today. Manual AWB entry + status updates on the Shipping page
// work regardless of whether this function is ever deployed.
//
// Expected shape once implemented, mirroring sp-api-sync:
//   - COURIER_API_KEY / COURIER_API_SECRET as env secrets
//   - fetch tracking status per AWB from the courier's API
//   - map their status codes to shipment_status (booked/in_transit/delivered/rto/failed)
//   - update shipments.status, insert a sync_logs row either way
//
// Invoke with: POST { channel_id?: string }  (channel_id unused today, kept
// for parity with sp-api-sync's invocation shape)
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const body = await req.json().catch(() => ({}))

  const { data: shipment } = await supabase.from('shipments').select('organization_id').limit(1).maybeSingle()
  const organizationId = shipment?.organization_id

  if (!organizationId) {
    return new Response(JSON.stringify({ status: 'skipped', message: 'No shipments to sync yet.' }), { status: 200 })
  }

  await supabase.from('sync_logs').insert({
    organization_id: organizationId,
    operation: 'courier_sync',
    status: 'failed',
    fault: 'order_sathi',
    message: 'courier-sync is not implemented yet — no courier API is wired up. Update shipment status manually on the Shipping page for now.',
    detail: body,
  })

  return new Response(JSON.stringify({ status: 'not_configured' }), { status: 501 })
})
