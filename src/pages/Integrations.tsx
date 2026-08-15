import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import type { Tables } from '../lib/database.types'

type Channel = Tables<'channels'>

export default function Integrations() {
  const { profile } = useAuth()
  const [channels, setChannels] = useState<Channel[]>([])
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    supabase.from('channels').select('*').then(({ data }) => setChannels(data ?? []))
  }, [orgId])

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Integrations</h2>
      <p className="text-xs text-slate-400 mb-6">Amazon SP-API is the only channel supported in this phase.</p>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-slate-900">Amazon SP-API</h3>
          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700">
            Integration Pending
          </span>
        </div>
        <p className="text-sm text-slate-500 mt-1">Pulls orders, pushes inventory, imports MTR reports.</p>
        <p className="text-xs text-slate-400 mt-2">
          The <code>sp-api-sync</code> edge function is deployed and validates requests, but every call needs your own
          Amazon Seller Central app credentials before it can pull real orders:
        </p>
        <ul className="text-xs text-slate-400 mt-2 list-disc list-inside space-y-0.5">
          <li>LWA Client ID + Client Secret (from Seller Central → Develop Apps)</li>
          <li>Refresh token (from authorizing this app against your seller account)</li>
          <li>Seller ID + Marketplace ID (India: A21TJRUUN4KGV)</li>
        </ul>
        {channels.length === 0 ? (
          <p className="text-xs text-slate-400 mt-3">No channel connected yet.</p>
        ) : (
          <div className="mt-3 space-y-1">
            {channels.map((c) => (
              <div key={c.id} className="text-xs text-slate-600 flex items-center justify-between">
                <span>{c.display_name}</span>
                <span className={c.status === 'connected' ? 'text-emerald-600' : 'text-amber-600'}>{c.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
