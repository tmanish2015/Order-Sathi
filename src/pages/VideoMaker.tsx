import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import type { Tables, Enums } from '../lib/database.types'

type Video = Tables<'videos'>

const GENERATE_VIDEO_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-video`

type TemplateKey = 'announcement' | 'product_highlight' | 'testimonial'

const TEMPLATES: { key: TemplateKey; label: string; description: string; fields: { name: string; label: string; type?: string }[] }[] = [
  {
    key: 'announcement',
    label: 'Announcement',
    description: 'Bold headline + subtext on a color background.',
    fields: [
      { name: 'headline', label: 'Headline' },
      { name: 'subtext', label: 'Subtext' },
    ],
  },
  {
    key: 'product_highlight',
    label: 'Product highlight',
    description: 'Product name, tagline, and price.',
    fields: [
      { name: 'product_name', label: 'Product name' },
      { name: 'tagline', label: 'Tagline' },
      { name: 'price', label: 'Price (INR)' },
    ],
  },
  {
    key: 'testimonial',
    label: 'Testimonial',
    description: 'Customer quote with author attribution.',
    fields: [
      { name: 'quote', label: 'Quote' },
      { name: 'author_name', label: 'Author name' },
      { name: 'author_role', label: 'Author role / company' },
    ],
  },
]

const STATUS_COLOR: Record<Enums<'video_status'>, string> = {
  draft: 'bg-slate-100 text-slate-600',
  pending: 'bg-amber-100 text-amber-700',
  rendering: 'bg-blue-100 text-blue-700',
  rendered: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
}

export default function VideoMaker() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [videos, setVideos] = useState<Video[]>([])
  const [showNew, setShowNew] = useState(false)
  const [template, setTemplate] = useState<TemplateKey>('announcement')
  const orgId = profile?.organization_id

  async function load() {
    const { data, error } = await supabase.from('videos').select('*').order('created_at', { ascending: false })
    if (error) reportError(showError, 'Load videos', error, orgId, profile?.id)
    setVideos(data ?? [])
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function createVideo(form: FormData) {
    if (!orgId) return
    const tmpl = TEMPLATES.find((t) => t.key === template)!
    const inputs: Record<string, string> = { name: String(form.get('name') || tmpl.label) }
    for (const f of tmpl.fields) inputs[f.name] = String(form.get(f.name) || '')

    const { data, error } = await supabase
      .from('videos')
      .insert({
        organization_id: orgId,
        name: inputs.name,
        template,
        inputs,
        status: 'draft',
        created_by: profile?.id,
      })
      .select()
      .single()

    if (error || !data) {
      reportError(showError, 'Create video', error ?? { message: 'insert returned no row' }, orgId, profile?.id)
      return
    }
    setShowNew(false)
    load()
    generateVideo(data.id)
  }

  async function generateVideo(videoId: string) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      showError('Sign in required to generate video.')
      return
    }
    try {
      const res = await fetch(GENERATE_VIDEO_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ video_id: videoId }),
      })
      const data = await res.json()
      if (res.status === 501) {
        showError(data.error)
      } else if (!res.ok) {
        reportError(showError, 'Generate video', { message: data.error ?? `request failed (${res.status})` }, orgId, profile?.id)
      } else {
        showSuccess('Video queued for rendering.')
      }
    } catch (err) {
      reportError(showError, 'Generate video', { message: err instanceof Error ? err.message : 'network error' }, orgId, profile?.id)
    }
    load()
  }

  const canWrite = profile && ['admin', 'marketing', 'sales'].includes(profile.role)
  const activeTemplate = TEMPLATES.find((t) => t.key === template)!

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Video Maker</h2>
          <p className="text-xs text-slate-400 mt-0.5">Template-based promo videos. Rendering needs a connected service — see Integrations.</p>
        </div>
        {canWrite && (
          <button onClick={() => setShowNew(true)} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700">
            + New video
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {videos.map((v) => (
          <div key={v.id} className="px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium text-sm text-slate-900">{v.name}</div>
              <div className="text-xs text-slate-400">
                {TEMPLATES.find((t) => t.key === v.template)?.label ?? v.template} · {format(new Date(v.created_at), 'dd MMM yyyy')}
              </div>
              {v.error_message && <p className="text-xs text-red-500 mt-1">{v.error_message}</p>}
            </div>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${STATUS_COLOR[v.status]}`}>{v.status}</span>
          </div>
        ))}
        {videos.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">No videos yet.</p>}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">New video</h3>
              <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <form action={(fd) => createVideo(fd)} className="space-y-3">
              <input name="name" placeholder="Video name" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value as TemplateKey)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400">{activeTemplate.description}</p>
              {activeTemplate.fields.map((f) => (
                <input key={f.name} name={f.name} placeholder={f.label} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              ))}
              <button type="submit" className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-700">
                Create & generate
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
