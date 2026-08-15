// Pushes current stock (ledger sum minus buffer stock) to Amazon for every
// active SKU on a channel, via the Listings Items API. One sync_logs row
// summarizes the run, plus a partial-status entry per SKU that fails.
//
// Needs, per channel, same as sp-api-sync: LWA_CLIENT_ID / LWA_CLIENT_SECRET
// (env) and channels.sp_api_refresh_token_secret_id (Vault). Each SKU also
// needs skus.product_type set — Amazon's Listings API can't patch a
// fulfillment_availability quantity without knowing the product type.
//
// Invoke with: POST { channel_id: string }
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SP_API_BASE = 'https://sellingpartnerapi-eu.amazon.com' // India marketplace routes through the EU endpoint

interface SyncLog {
  operation: string
  status: 'success' | 'failed' | 'partial'
  fault?: 'amazon' | 'order_sathi' | 'seller_data' | 'unknown'
  message: string
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const clientId = Deno.env.get('LWA_CLIENT_ID')
  const clientSecret = Deno.env.get('LWA_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw { fault: 'order_sathi', message: 'LWA_CLIENT_ID / LWA_CLIENT_SECRET not configured on the server' }
  }

  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw { fault: res.status === 400 ? 'seller_data' : 'amazon', message: `LWA token exchange failed (${res.status}): ${body}` }
  }

  const json = await res.json()
  return json.access_token
}

async function pushQuantity(accessToken: string, sellerId: string, marketplaceId: string, sku: string, productType: string, quantity: number) {
  const url = new URL(`/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}`, SP_API_BASE)
  url.searchParams.set('marketplaceIds', marketplaceId)

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productType,
      patches: [
        {
          op: 'replace',
          path: '/attributes/fulfillment_availability',
          value: [{ fulfillment_channel_code: 'DEFAULT', quantity }],
        },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw { fault: res.status >= 500 ? 'amazon' : 'order_sathi', message: `Listings API failed (${res.status}): ${body}` }
  }
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { channel_id } = await req.json().catch(() => ({}))

  if (!channel_id) {
    return new Response('channel_id required', { status: 400 })
  }

  const { data: channel } = await supabase.from('channels').select('*').eq('id', channel_id).maybeSingle()
  if (!channel) {
    return new Response('channel not found', { status: 404 })
  }

  const logs: SyncLog[] = []
  const startedAt = new Date().toISOString()

  async function finish(status: SyncLog['status']) {
    for (const log of logs) {
      await supabase.from('sync_logs').insert({
        organization_id: channel.organization_id,
        channel_id: channel.id,
        operation: log.operation,
        status: log.status,
        fault: log.fault ?? null,
        message: log.message,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      })
    }
    return new Response(JSON.stringify({ status }), { status: status === 'failed' ? 500 : 200 })
  }

  if (!channel.sp_api_refresh_token_secret_id) {
    logs.push({ operation: 'inventory_push', status: 'failed', fault: 'seller_data', message: 'No Amazon refresh token connected for this channel yet.' })
    return finish('failed')
  }

  try {
    const { data: secret, error: secretError } = await supabase
      .schema('vault')
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('id', channel.sp_api_refresh_token_secret_id)
      .maybeSingle()

    if (secretError || !secret) {
      throw { fault: 'order_sathi', message: `Could not read refresh token from Vault: ${secretError?.message ?? 'not found'}` }
    }

    const accessToken = await getAccessToken(secret.decrypted_secret)

    const { data: skus } = await supabase.from('skus').select('*').eq('organization_id', channel.organization_id).eq('active', true)
    const { data: ledger } = await supabase.from('inventory_ledger').select('sku_id, quantity_delta').eq('organization_id', channel.organization_id)

    const stockBySku = new Map<string, number>()
    for (const row of ledger ?? []) {
      stockBySku.set(row.sku_id, (stockBySku.get(row.sku_id) ?? 0) + row.quantity_delta)
    }

    let pushed = 0
    let skipped = 0
    for (const sku of skus ?? []) {
      if (!sku.product_type) {
        skipped++
        logs.push({ operation: 'inventory_push', status: 'partial', fault: 'seller_data', message: `SKU ${sku.sku} has no product_type set — skipped. Set it on the SKU before it can push.` })
        continue
      }
      const stock = stockBySku.get(sku.id) ?? 0
      const available = Math.max(stock - sku.buffer_stock, 0)
      try {
        await pushQuantity(accessToken, channel.seller_id, channel.marketplace_id, sku.sku, sku.product_type, available)
        pushed++
      } catch (err) {
        const e = err as { fault?: SyncLog['fault']; message?: string }
        logs.push({ operation: 'inventory_push', status: 'partial', fault: e.fault ?? 'unknown', message: `SKU ${sku.sku}: ${e.message ?? String(err)}` })
      }
    }

    logs.push({ operation: 'inventory_push', status: 'success', message: `Pushed ${pushed} of ${(skus ?? []).length} SKUs (${skipped} skipped, missing product type).` })
    return finish(logs.some((l) => l.status === 'partial') ? 'partial' : 'success')
  } catch (err) {
    const e = err as { fault?: SyncLog['fault']; message?: string }
    logs.push({ operation: 'inventory_push', status: 'failed', fault: e.fault ?? 'unknown', message: e.message ?? String(err) })
    return finish('failed')
  }
})
