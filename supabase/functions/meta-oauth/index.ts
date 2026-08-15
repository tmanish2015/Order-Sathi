// Meta (Facebook/Instagram) OAuth connect flow.
// GET /meta-oauth  (Authorization: Bearer <supabase access token>)
//                            -> returns { url } to the Facebook OAuth dialog,
//                               with state derived from the caller's own
//                               profile — never a hardcoded/fallback org.
// GET /meta-oauth?code=...   -> callback: verifies state, exchanges code,
//                               fetches Pages (+ linked Instagram business
//                               accounts), stores tokens in Supabase Vault
//                               (never in a plaintext column), redirects
//                               back to the app.
//
// Requires these secrets (set via `supabase secrets set`) before it can run:
//   META_APP_ID, META_APP_SECRET, META_REDIRECT_URI (this function's own
//   public URL), FRONTEND_URL (where to send the user back to, e.g.
//   http://localhost:5184/campaigns or the production domain)
//
// CSRF state: signed with SUPABASE_SERVICE_ROLE_KEY (already present in every
// edge function's environment, so this needs no extra secret) rather than a
// static value, and verified + time-bound on the callback.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const GRAPH_VERSION = 'v21.0'
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'].join(',')
const STATE_TTL_MS = 15 * 60 * 1000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signState(orgId: string, ts: number, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${orgId}.${ts}`))
  return b64url(new Uint8Array(mac))
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const appId = Deno.env.get('META_APP_ID')
  const appSecret = Deno.env.get('META_APP_SECRET')
  const redirectUri = Deno.env.get('META_REDIRECT_URI')
  const frontendUrl = Deno.env.get('FRONTEND_URL') ?? '/'
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey)

  if (!appId || !appSecret || !redirectUri) {
    return jsonError('Meta OAuth not configured: set META_APP_ID, META_APP_SECRET, META_REDIRECT_URI secrets.', 500)
  }

  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    return Response.redirect(`${frontendUrl}?meta_error=${encodeURIComponent(error)}`, 302)
  }

  // Step 1: no code yet — this is the "connect" click. Requires a real
  // session; the org to connect against comes from that user's own profile,
  // never from a hardcoded constant or a "just pick one" fallback.
  if (!code) {
    const authHeader = req.headers.get('authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) {
      return jsonError('sign in required', 401)
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
    if (userErr || !userData.user) {
      return jsonError('invalid session', 401)
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, status')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (!profile || profile.status !== 'active') {
      return jsonError('account not active', 403)
    }

    const orgId = profile.organization_id
    const ts = Date.now()
    const sig = await signState(orgId, ts, serviceRoleKey)
    const state = `${orgId}.${ts}.${sig}`

    const authUrl = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`)
    authUrl.searchParams.set('client_id', appId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', SCOPES)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('response_type', 'code')

    return new Response(JSON.stringify({ url: authUrl.toString() }), { status: 200, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  // Step 1b: callback — verify the state before doing anything else. The
  // org id embedded here was resolved from the real user's profile in step
  // 1 above and is cryptographically bound to this request by the signature.
  const stateParam = url.searchParams.get('state') ?? ''
  const [orgId, tsStr, sig] = stateParam.split('.')
  const ts = Number(tsStr)
  if (!orgId || !ts || !sig) {
    return Response.redirect(`${frontendUrl}?meta_error=${encodeURIComponent('invalid oauth state')}`, 302)
  }
  if (Date.now() - ts > STATE_TTL_MS) {
    return Response.redirect(`${frontendUrl}?meta_error=${encodeURIComponent('oauth state expired, please reconnect')}`, 302)
  }
  const expectedSig = await signState(orgId, ts, serviceRoleKey)
  if (expectedSig !== sig) {
    return Response.redirect(`${frontendUrl}?meta_error=${encodeURIComponent('oauth state signature mismatch')}`, 302)
  }

  // Step 2: exchange code for a short-lived user token.
  const tokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`)
  tokenUrl.searchParams.set('client_id', appId)
  tokenUrl.searchParams.set('client_secret', appSecret)
  tokenUrl.searchParams.set('redirect_uri', redirectUri)
  tokenUrl.searchParams.set('code', code)
  const tokenRes = await fetch(tokenUrl.toString())
  const tokenData = await tokenRes.json()
  if (!tokenRes.ok || !tokenData.access_token) {
    return Response.redirect(`${frontendUrl}?meta_error=${encodeURIComponent(tokenData.error?.message ?? 'token exchange failed')}`, 302)
  }

  // Step 3: exchange for a long-lived user token (~60 days).
  const longUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`)
  longUrl.searchParams.set('grant_type', 'fb_exchange_token')
  longUrl.searchParams.set('client_id', appId)
  longUrl.searchParams.set('client_secret', appSecret)
  longUrl.searchParams.set('fb_exchange_token', tokenData.access_token)
  const longRes = await fetch(longUrl.toString())
  const longData = await longRes.json()
  const userToken = longData.access_token ?? tokenData.access_token
  const expiresIn = longData.expires_in ?? tokenData.expires_in ?? 3600

  // Step 4: list the Pages this user manages (each has its own page access token).
  const pagesRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${userToken}`
  )
  const pagesData = await pagesRes.json()
  if (!pagesRes.ok) {
    return Response.redirect(`${frontendUrl}?meta_error=${encodeURIComponent(pagesData.error?.message ?? 'failed to list pages')}`, 302)
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
  let connected = 0

  // Tokens never touch a plaintext column: each one is sealed in Supabase
  // Vault and only the opaque secret UUID is written to social_accounts.
  async function storeToken(token: string, label: string) {
    const { data, error } = await supabase.schema('vault').rpc('create_secret', {
      new_secret: token,
      new_name: `meta_token_${label}_${crypto.randomUUID()}`,
    })
    if (error) throw new Error(`vault store failed: ${error.message}`)
    return data as string
  }

  for (const page of pagesData.data ?? []) {
    const pageSecretId = await storeToken(page.access_token, page.id)
    await supabase.from('social_accounts').insert({
      organization_id: orgId,
      platform: 'facebook',
      account_name: page.name,
      access_token_secret_id: pageSecretId,
      expires_at: expiresAt,
      status: 'active',
    })
    connected++

    if (page.instagram_business_account?.id) {
      await supabase.from('social_accounts').insert({
        organization_id: orgId,
        platform: 'instagram',
        account_name: page.instagram_business_account.username ?? page.name,
        access_token_secret_id: pageSecretId,
        expires_at: expiresAt,
        status: 'active',
      })
      connected++
    }
  }

  return Response.redirect(`${frontendUrl}?meta_connected=${connected}`, 302)
})
