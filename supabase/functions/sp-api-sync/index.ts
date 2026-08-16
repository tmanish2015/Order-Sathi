// Pulls new/updated orders from Amazon SP-API into the orders/order_line_items
// tables, deducts inventory, and writes one sync_logs row describing what
// happened — success or failure, and whose fault it was.
//
// Needs, per channel, before this does anything real:
//   - LWA_CLIENT_ID / LWA_CLIENT_SECRET (env, from Seller Central > Develop Apps)
//   - channels.sp_api_refresh_token_secret_id -> a Supabase Vault secret
//     holding the refresh token obtained when the seller authorized this app
//   - channels.seller_id / channels.marketplace_id (India: A21TJRUUN4KGV)
//
// Invoke with: POST { channel_id: string }
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SP_API_BASE = 'https://sellingpartnerapi-eu.amazon.com' // India marketplace routes through the EU endpoint

interface SyncLog {
  operation: string
  status: 'success' | 'failed' | 'partial'
  fault?: 'amazon' | 'order_sathi' | 'seller_data' | 'unknown'
  message: string
  detail?: unknown
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
    // A bad/expired refresh token means the seller needs to reconnect - that's
    // a seller-side data problem, not ours or Amazon's outage.
    throw { fault: res.status === 400 ? 'seller_data' : 'amazon', message: `LWA token exchange failed (${res.status}): ${body}` }
  }

  const json = await res.json()
  return json.access_token
}

async function fetchOrders(accessToken: string, marketplaceId: string, createdAfter: string) {
  const url = new URL('/orders/v0/orders', SP_API_BASE)
  url.searchParams.set('MarketplaceIds', marketplaceId)
  url.searchParams.set('CreatedAfter', createdAfter)

  const res = await fetch(url, { headers: { 'x-amz-access-token': accessToken } })
  if (!res.ok) {
    const body = await res.text()
    throw { fault: res.status >= 500 ? 'amazon' : 'order_sathi', message: `Orders API failed (${res.status}): ${body}` }
  }
  const json = await res.json()
  return json.payload?.Orders ?? []
}

async function fetchOrderItems(accessToken: string, amazonOrderId: string) {
  const url = new URL(`/orders/v0/orders/${amazonOrderId}/orderItems`, SP_API_BASE)
  const res = await fetch(url, { headers: { 'x-amz-access-token': accessToken } })
  if (!res.ok) {
    const body = await res.text()
    throw { fault: res.status >= 500 ? 'amazon' : 'order_sathi', message: `OrderItems API failed (${res.status}): ${body}` }
  }
  const json = await res.json()
  return json.payload?.OrderItems ?? []
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
        detail: log.detail ? JSON.parse(JSON.stringify(log.detail)) : null,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      })
    }
    return new Response(JSON.stringify({ status }), { status: status === 'failed' ? 500 : 200 })
  }

  if (!channel.sp_api_refresh_token_secret_id) {
    logs.push({
      operation: 'order_pull',
      status: 'failed',
      fault: 'seller_data',
      message: 'No Amazon refresh token connected for this channel yet. Connect Amazon SP-API from Integrations first.',
    })
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

    // Pull orders created in the last 24h - a scheduled trigger should call
    // this function periodically; this is not itself a cron job.
    const createdAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const amazonOrders = await fetchOrders(accessToken, channel.marketplace_id, createdAfter)

    const { data: defaultWarehouse } = await supabase
      .from('warehouses')
      .select('id')
      .eq('organization_id', channel.organization_id)
      .eq('is_default', true)
      .limit(1)
      .maybeSingle()

    let synced = 0
    for (const ao of amazonOrders) {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .upsert(
          {
            organization_id: channel.organization_id,
            channel_id: channel.id,
            amazon_order_id: ao.AmazonOrderId,
            order_status: mapOrderStatus(ao.OrderStatus),
            order_date: ao.PurchaseDate,
            buyer_state: ao.ShippingAddress?.StateOrRegion ?? null,
            ship_state: ao.ShippingAddress?.StateOrRegion ?? null,
            ship_address: formatShippingAddress(ao.ShippingAddress),
            sla_due_at: ao.LatestShipDate ?? null,
            gross_amount: Number(ao.OrderTotal?.Amount ?? 0),
            raw_payload: ao,
          },
          { onConflict: 'organization_id,channel_id,amazon_order_id' }
        )
        .select()
        .single()

      if (orderError || !order) {
        logs.push({ operation: 'order_pull', status: 'partial', fault: 'order_sathi', message: `Failed to save order ${ao.AmazonOrderId}: ${orderError?.message}` })
        continue
      }

      const items = await fetchOrderItems(accessToken, ao.AmazonOrderId)
      for (const item of items) {
        const { data: sku } = await supabase.from('skus').select('id').eq('organization_id', channel.organization_id).eq('sku', item.SellerSKU).maybeSingle()
        if (!sku) {
          logs.push({ operation: 'order_pull', status: 'partial', fault: 'seller_data', message: `SKU ${item.SellerSKU} on order ${ao.AmazonOrderId} not found in inventory — add it under Inventory first.` })
          continue
        }

        await supabase.from('order_line_items').insert({
          organization_id: channel.organization_id,
          order_id: order.id,
          sku_id: sku.id,
          quantity: item.QuantityOrdered,
          unit_price: Number(item.ItemPrice?.Amount ?? 0),
        })

        if (!defaultWarehouse) {
          logs.push({ operation: 'order_pull', status: 'partial', fault: 'seller_data', message: `No default warehouse set — order ${ao.AmazonOrderId} imported but stock wasn't deducted. Add a warehouse first.` })
          continue
        }

        await supabase.from('inventory_ledger').insert({
          organization_id: channel.organization_id,
          sku_id: sku.id,
          warehouse_id: defaultWarehouse.id,
          movement_type: 'order_deduction',
          quantity_delta: -item.QuantityOrdered,
          order_id: order.id,
          note: `Order ${ao.AmazonOrderId}`,
        })
      }
      synced++
    }

    logs.push({ operation: 'order_pull', status: 'success', message: `Synced ${synced} of ${amazonOrders.length} orders.` })
    return finish(logs.some((l) => l.status === 'partial') ? 'partial' : 'success')
  } catch (err) {
    const e = err as { fault?: SyncLog['fault']; message?: string }
    logs.push({ operation: 'order_pull', status: 'failed', fault: e.fault ?? 'unknown', message: e.message ?? String(err) })
    return finish('failed')
  }
})

// Full name/address lines require a Restricted Data Token (PII grant) most
// sellers don't have by default - falls back to whatever SP-API actually
// returns (usually just city/state/postal/country without one).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatShippingAddress(addr: any): string | null {
  if (!addr) return null
  const lines = [addr.Name, addr.AddressLine1, addr.AddressLine2, addr.AddressLine3, [addr.City, addr.StateOrRegion, addr.PostalCode].filter(Boolean).join(', '), addr.CountryCode].filter(Boolean)
  return lines.length > 0 ? lines.join('\n') : null
}

// A synced order always lands as 'new' regardless of Amazon's own status,
// even if Amazon already shows it Shipped/Cancelled by the time we first
// see it — this app's workflow (allocate/pick/pack/ship) hasn't run for it
// yet, so it can't skip straight to a downstream state.
function mapOrderStatus(_amazonStatus: string): 'new' {
  return 'new'
}
