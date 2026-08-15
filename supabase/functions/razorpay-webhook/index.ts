// Receives Razorpay webhook events and syncs subscription/invoice state.
// Configure this URL in the Razorpay dashboard webhook settings, with the
// same secret as RAZORPAY_WEBHOOK_SECRET (set via `supabase secrets set`).
import { createClient } from 'jsr:@supabase/supabase-js@2'

async function verifySignature(body: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return expected === signature
}

Deno.serve(async (req) => {
  const rawBody = await req.text()
  const signature = req.headers.get('x-razorpay-signature') ?? ''
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? ''

  if (!secret || !(await verifySignature(rawBody, signature, secret))) {
    return new Response('invalid signature', { status: 400 })
  }

  const event = JSON.parse(rawBody)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const rzpSubId: string | undefined = event.payload?.subscription?.entity?.id
  const rzpPayment = event.payload?.payment?.entity

  // Derive the organization from the subscription this event actually belongs
  // to, never from a hardcoded constant — a webhook has no authenticated user
  // to derive org context from, so the matched record is the only trustworthy
  // source of it.
  let subscription = null
  if (rzpSubId) {
    const { data } = await supabase.from('subscriptions').select('*').eq('razorpay_subscription_id', rzpSubId).maybeSingle()
    subscription = data
  }

  // No subscription matched (e.g. a test event, or one that predates our
  // records) — payment_events still needs an org to satisfy its NOT NULL
  // constraint; fall back to the only org that exists today rather than a
  // literal so this keeps working once a second org is added and this
  // fallback is replaced with real per-account routing.
  let orgId = subscription?.organization_id
  if (!orgId) {
    const { data: org } = await supabase.from('organizations').select('id').limit(1).maybeSingle()
    orgId = org?.id
  }
  if (!orgId) {
    return new Response('no organization to attribute this event to', { status: 500 })
  }

  await supabase.from('payment_events').insert({
    organization_id: orgId,
    subscription_id: subscription?.id ?? null,
    event_type: event.event,
    payload: event,
  })

  if (!subscription) {
    return new Response('ok (no matching subscription)', { status: 200 })
  }

  switch (event.event) {
    case 'subscription.charged': {
      await supabase
        .from('subscriptions')
        .update({ status: 'active', failed_charge_count: 0 })
        .eq('id', subscription.id)
      await supabase.from('invoices').insert({
        organization_id: subscription.organization_id,
        subscription_id: subscription.id,
        customer_id: subscription.customer_id,
        amount: rzpPayment ? rzpPayment.amount / 100 : 0,
        razorpay_payment_id: rzpPayment?.id ?? null,
        razorpay_invoice_id: event.payload?.invoice?.entity?.id ?? null,
        status: 'paid',
        paid_at: new Date().toISOString(),
      })
      break
    }
    case 'subscription.pending': {
      await supabase.from('subscriptions').update({ status: 'past_due' }).eq('id', subscription.id)
      break
    }
    case 'subscription.halted': {
      await supabase.from('subscriptions').update({ status: 'cancelled' }).eq('id', subscription.id)
      break
    }
    case 'payment.failed': {
      const failedCount = (subscription.failed_charge_count ?? 0) + 1
      await supabase
        .from('subscriptions')
        .update({ status: 'past_due', failed_charge_count: failedCount })
        .eq('id', subscription.id)
      await supabase.from('invoices').insert({
        organization_id: subscription.organization_id,
        subscription_id: subscription.id,
        customer_id: subscription.customer_id,
        amount: rzpPayment ? rzpPayment.amount / 100 : 0,
        razorpay_payment_id: rzpPayment?.id ?? null,
        status: 'failed',
      })
      break
    }
  }

  return new Response('ok', { status: 200 })
})
