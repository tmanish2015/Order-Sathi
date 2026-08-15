import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import type { Tables, TablesInsert, Enums } from '../lib/database.types'

type Campaign = Tables<'campaigns'>
type Post = Tables<'campaign_posts'>

const PLATFORMS: Enums<'social_platform'>[] = ['facebook', 'instagram', 'linkedin', 'twitter']
const PLATFORM_COLOR: Record<Enums<'social_platform'>, string> = {
  facebook: 'bg-blue-100 text-blue-700',
  instagram: 'bg-pink-100 text-pink-700',
  linkedin: 'bg-sky-100 text-sky-700',
  twitter: 'bg-slate-200 text-slate-700',
}

type SocialAccount = Tables<'social_accounts'>

const META_OAUTH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-oauth`

export default function Campaigns() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [showAddCampaign, setShowAddCampaign] = useState(false)
  const [addingPostFor, setAddingPostFor] = useState<string | null>(null)
  const orgId = profile?.organization_id

  const params = new URLSearchParams(window.location.search)
  const metaConnected = params.get('meta_connected')
  const metaError = params.get('meta_error')

  async function load() {
    const [{ data: c }, { data: p }, { data: a }] = await Promise.all([
      supabase.from('campaigns').select('*').order('created_at', { ascending: false }),
      supabase.from('campaign_posts').select('*').order('scheduled_at', { ascending: true }),
      supabase.from('social_accounts').select('*').order('connected_at', { ascending: false }),
    ])
    setCampaigns(c ?? [])
    setPosts(p ?? [])
    setAccounts(a ?? [])
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function disconnectAccount(id: string) {
    const { error } = await supabase.from('social_accounts').update({ status: 'disconnected' }).eq('id', id)
    if (error) {
      reportError(showError, 'Disconnect account', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function connectMeta() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      showError('Sign in required to connect Meta.')
      return
    }
    try {
      const res = await fetch(META_OAUTH_URL, { headers: { Authorization: `Bearer ${session.access_token}` } })
      const data = await res.json()
      if (!res.ok || !data.url) {
        reportError(showError, 'Connect Meta', { message: data.error ?? `request failed (${res.status})` }, orgId, profile?.id)
        return
      }
      window.location.href = data.url
    } catch (err) {
      reportError(showError, 'Connect Meta', { message: err instanceof Error ? err.message : 'network error' }, orgId, profile?.id)
    }
  }

  async function addCampaign(form: FormData) {
    if (!orgId) return
    const platforms = PLATFORMS.filter((p) => form.get(`platform_${p}`) === 'on')
    const payload: TablesInsert<'campaigns'> = {
      organization_id: orgId,
      name: String(form.get('name')),
      objective: String(form.get('objective') || '') || null,
      platforms,
      created_by: profile?.id,
    }
    const { error } = await supabase.from('campaigns').insert(payload)
    if (error) {
      reportError(showError, 'Add campaign', error, orgId, profile?.id)
      return
    }
    showSuccess('Campaign created.')
    setShowAddCampaign(false)
    load()
  }

  async function addPost(form: FormData) {
    if (!addingPostFor || !orgId) return
    const payload: TablesInsert<'campaign_posts'> = {
      organization_id: orgId,
      campaign_id: addingPostFor,
      platform: form.get('platform') as Enums<'social_platform'>,
      content: String(form.get('content') || '') || null,
      scheduled_at: new Date(String(form.get('scheduled_at'))).toISOString(),
      mode: form.get('mode') as Enums<'post_mode'>,
      status: 'scheduled',
      created_by: profile?.id,
    }
    const { error } = await supabase.from('campaign_posts').insert(payload)
    if (error) {
      reportError(showError, 'Schedule post', error, orgId, profile?.id)
      return
    }
    showSuccess('Post scheduled.')
    setAddingPostFor(null)
    load()
  }

  async function markPosted(post: Post) {
    const { error } = await supabase
      .from('campaign_posts')
      .update({ status: 'posted', posted_at: new Date().toISOString() })
      .eq('id', post.id)
    if (error) {
      reportError(showError, 'Mark post as posted', error, orgId, profile?.id)
      return
    }
    load()
  }

  const canWrite = profile && ['admin', 'marketing'].includes(profile.role)
  const upcoming = [...posts].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-900">Social Media Campaigns</h2>
        {canWrite && (
          <button
            onClick={() => setShowAddCampaign(true)}
            className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700"
          >
            + Campaign
          </button>
        )}
      </div>

      {(metaConnected || metaError) && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${metaError ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {metaError ? `Meta connect failed: ${metaError}` : `Connected ${metaConnected} Meta account(s).`}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Connected accounts</h3>
          {canWrite && (
            <button
              onClick={connectMeta}
              className="text-xs rounded-lg bg-blue-600 text-white px-3 py-1.5 hover:bg-blue-700"
            >
              Connect Meta (Facebook/Instagram)
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {accounts
            .filter((a) => a.status === 'active')
            .map((a) => (
              <span key={a.id} className={`text-xs px-2 py-1 rounded flex items-center gap-2 ${PLATFORM_COLOR[a.platform]}`}>
                {a.platform}: {a.account_name}
                {canWrite && (
                  <button onClick={() => disconnectAccount(a.id)} className="hover:underline">
                    ✕
                  </button>
                )}
              </span>
            ))}
          {accounts.filter((a) => a.status === 'active').length === 0 && (
            <p className="text-sm text-slate-400">No accounts connected yet.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="col-span-1 space-y-2">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Campaigns</h3>
          {campaigns.map((c) => (
            <div key={c.id} className="bg-white rounded-lg border border-slate-200 p-3">
              <div className="font-medium text-sm text-slate-900">{c.name}</div>
              <div className="text-xs text-slate-400">{c.objective}</div>
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {c.platforms.map((p) => (
                  <span key={p} className={`text-[10px] px-1.5 py-0.5 rounded ${PLATFORM_COLOR[p]}`}>
                    {p}
                  </span>
                ))}
              </div>
              {canWrite && (
                <button
                  onClick={() => setAddingPostFor(c.id)}
                  className="text-xs text-indigo-600 hover:underline mt-2"
                >
                  + Schedule post
                </button>
              )}
            </div>
          ))}
          {campaigns.length === 0 && <p className="text-sm text-slate-400">No campaigns yet.</p>}
        </div>

        <div className="col-span-2">
          <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Content Calendar</h3>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {upcoming.map((post) => {
              const campaign = campaigns.find((c) => c.id === post.campaign_id)
              return (
                <div key={post.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                  <div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded mr-2 ${PLATFORM_COLOR[post.platform]}`}>
                      {post.platform}
                    </span>
                    <span className="text-slate-700">{campaign?.name}</span>
                    <span className="text-slate-400 ml-2">{post.content?.slice(0, 40)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">{format(new Date(post.scheduled_at), 'dd MMM, HH:mm')}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        post.status === 'posted'
                          ? 'bg-emerald-100 text-emerald-700'
                          : post.status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {post.mode === 'auto' ? 'auto' : 'plan-only'} · {post.status}
                    </span>
                    {post.mode === 'plan_only' && post.status !== 'posted' && canWrite && (
                      <label className="flex items-center gap-1 text-xs text-slate-500">
                        <input type="checkbox" onChange={() => markPosted(post)} /> posted
                      </label>
                    )}
                  </div>
                </div>
              )
            })}
            {upcoming.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No posts scheduled.</p>}
          </div>
        </div>
      </div>

      {showAddCampaign && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">New campaign</h3>
              <button onClick={() => setShowAddCampaign(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <form action={(fd) => addCampaign(fd)} className="space-y-3">
              <input name="name" required placeholder="Campaign name" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input name="objective" placeholder="Objective" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <div className="flex gap-3">
                {PLATFORMS.map((p) => (
                  <label key={p} className="flex items-center gap-1 text-xs text-slate-600">
                    <input type="checkbox" name={`platform_${p}`} /> {p}
                  </label>
                ))}
              </div>
              <button type="submit" className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-700">
                Save
              </button>
            </form>
          </div>
        </div>
      )}

      {addingPostFor && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">Schedule post</h3>
              <button onClick={() => setAddingPostFor(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <form action={(fd) => addPost(fd)} className="space-y-3">
              <select name="platform" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <textarea name="content" placeholder="Post content" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={3} />
              <input name="scheduled_at" type="datetime-local" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <select name="mode" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="plan_only">Plan-only (manual posting)</option>
                <option value="auto">Auto-post</option>
              </select>
              <button type="submit" className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-700">
                Save
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
