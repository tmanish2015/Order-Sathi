import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import type { Tables } from '../lib/database.types'

type Creative = Tables<'creatives'>

export default function Creatives() {
  const { profile } = useAuth()
  const { showError } = useToast()
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [loading, setLoading] = useState(true)
  const orgId = profile?.organization_id

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('creatives').select('*').order('updated_at', { ascending: false })
    if (error) {
      reportError(showError, 'Load creatives', error, orgId, profile?.id)
    }
    setCreatives(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function remove(id: string) {
    const { error } = await supabase.from('creatives').delete().eq('id', id)
    if (error) {
      reportError(showError, 'Delete creative', error, orgId, profile?.id)
      return
    }
    load()
  }

  const canWrite = profile && ['admin', 'marketing', 'sales'].includes(profile.role)

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Creative Studio</h2>
          <p className="text-xs text-slate-400 mt-0.5">Design social posts, banners, and promo graphics — export as PNG.</p>
        </div>
        {canWrite && (
          <Link to="/studio/new" className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700">
            + New creative
          </Link>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : creatives.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">
          No creatives yet. {canWrite && 'Start your first one above.'}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {creatives.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden group">
              <Link to={`/studio/${c.id}`} className="block aspect-square bg-slate-100">
                {c.thumbnail_url ? (
                  <img src={c.thumbnail_url} alt={c.name} className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">No preview</div>
                )}
              </Link>
              <div className="p-2.5 flex items-center justify-between gap-2">
                <Link to={`/studio/${c.id}`} className="text-sm font-medium text-slate-900 truncate hover:text-indigo-600">
                  {c.name}
                </Link>
                {canWrite && (
                  <button onClick={() => remove(c.id)} className="text-xs text-slate-400 hover:text-red-600 shrink-0">
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
