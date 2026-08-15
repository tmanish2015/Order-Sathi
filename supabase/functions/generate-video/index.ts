// Renders a video from a saved `videos` row using a template + inputs.
// GET/POST /generate-video  (Authorization: Bearer <supabase access token>)
//   body: { video_id: string }
//
// Requires a video-rendering service to actually produce output. None is
// connected yet - this function authenticates the caller, validates the
// video belongs to their org, and then fails closed with a clear
// "Integration Pending" message rather than pretending to render anything.
// Wire up a real provider (e.g. Shotstack, Creatomate) by setting
// RENDER_API_KEY / RENDER_API_URL secrets and replacing the TODO block below
// with the actual API call.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return jsonResponse({ error: 'sign in required' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
  if (userErr || !userData.user) return jsonResponse({ error: 'invalid session' }, 401)

  const { video_id } = await req.json().catch(() => ({}))
  if (!video_id) return jsonResponse({ error: 'video_id is required' }, 400)

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, status')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (!profile || profile.status !== 'active') return jsonResponse({ error: 'account not active' }, 403)

  const { data: video, error: videoErr } = await supabase
    .from('videos')
    .select('*')
    .eq('id', video_id)
    .eq('organization_id', profile.organization_id)
    .maybeSingle()
  if (videoErr || !video) return jsonResponse({ error: 'video not found' }, 404)

  const renderApiKey = Deno.env.get('RENDER_API_KEY')
  const renderApiUrl = Deno.env.get('RENDER_API_URL')

  if (!renderApiKey || !renderApiUrl) {
    await supabase
      .from('videos')
      .update({
        status: 'failed',
        error_message: 'Video rendering not configured: set RENDER_API_KEY and RENDER_API_URL secrets for a rendering provider (e.g. Shotstack, Creatomate).',
        updated_at: new Date().toISOString(),
      })
      .eq('id', video_id)
    return jsonResponse(
      { error: 'Video rendering is not configured yet. This template and its inputs were saved — rendering will work once a rendering-service integration is connected.' },
      501
    )
  }

  // TODO: once RENDER_API_KEY/RENDER_API_URL are set, replace this block with
  // the real provider call: submit video.template + video.inputs, get back a
  // render job id or direct output_url, and update the row accordingly
  // (status='rendering' then poll, or status='rendered' + output_url if sync).
  await supabase.from('videos').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', video_id)
  return jsonResponse({ ok: true, status: 'pending' }, 200)
})
