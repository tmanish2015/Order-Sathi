import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import type { Tables } from '../lib/database.types'

type Order = Tables<'orders'>
type Sku = Tables<'skus'>

export default function GlobalSearch({ onNavigate }: { onNavigate?: () => void }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [skus, setSkus] = useState<Sku[]>([])
  const boxRef = useRef<HTMLDivElement>(null)
  const orgId = profile?.organization_id

  useEffect(() => {
    const q = query.trim()
    if (!orgId || q.length < 2) {
      setOrders([])
      setSkus([])
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      const [{ data: o }, { data: s }] = await Promise.all([
        supabase.from('orders').select('*').or(`amazon_order_id.ilike.%${q}%,customer_name.ilike.%${q}%`).limit(5),
        supabase.from('skus').select('*').or(`sku.ilike.%${q}%,title.ilike.%${q}%`).limit(5),
      ])
      setOrders(o ?? [])
      setSkus(s ?? [])
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, orgId])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function go(to: string) {
    setOpen(false)
    setQuery('')
    navigate(to)
    onNavigate?.()
  }

  function submit() {
    const q = query.trim()
    if (!q) return
    go(`/orders?q=${encodeURIComponent(q)}`)
  }

  const hasResults = orders.length > 0 || skus.length > 0

  return (
    <div ref={boxRef} className="relative w-full">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Search orders, SKUs, customers…"
        className="w-full text-sm rounded-lg border border-white/10 bg-white/5 text-white placeholder:text-slate-400 px-3 py-1.5 outline-none focus:border-indigo-400"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 w-full max-h-96 overflow-y-auto rounded-lg bg-white border border-slate-200 shadow-lg text-sm">
          {loading ? (
            <div className="px-3 py-2 text-slate-400">Searching…</div>
          ) : !hasResults ? (
            <div className="px-3 py-2 text-slate-400">No matches.</div>
          ) : (
            <>
              {orders.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase text-slate-400">Orders</div>
                  {orders.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => go(`/orders?q=${encodeURIComponent(o.amazon_order_id)}`)}
                      className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center justify-between gap-2"
                    >
                      <span className="font-medium text-slate-700">{o.amazon_order_id}</span>
                      <span className="text-xs text-slate-400 truncate">{o.customer_name || '—'}</span>
                    </button>
                  ))}
                </div>
              )}
              {skus.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase text-slate-400">Products</div>
                  {skus.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => go(`/inventory?q=${encodeURIComponent(s.sku)}`)}
                      className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center justify-between gap-2"
                    >
                      <span className="font-medium text-slate-700">{s.sku}</span>
                      <span className="text-xs text-slate-400 truncate">{s.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
