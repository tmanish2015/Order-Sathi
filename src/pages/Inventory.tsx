import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import type { Tables } from '../lib/database.types'

type Sku = Tables<'skus'>
type Ledger = Tables<'inventory_ledger'>

export default function Inventory() {
  const { profile } = useAuth()
  const [skus, setSkus] = useState<Sku[]>([])
  const [stockBySku, setStockBySku] = useState<Record<string, number>>({})
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      const [{ data: s }, { data: l }] = await Promise.all([
        supabase.from('skus').select('*').order('sku'),
        supabase.from('inventory_ledger').select('*'),
      ])
      setSkus(s ?? [])
      const totals: Record<string, number> = {}
      for (const row of (l ?? []) as Ledger[]) {
        totals[row.sku_id] = (totals[row.sku_id] ?? 0) + row.quantity_delta
      }
      setStockBySku(totals)
    })()
  }, [orgId])

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Inventory</h2>
      <p className="text-xs text-slate-400 mb-6">
        One central ledger per SKU. Stock = sum of every movement (order deduction, restock, return, manual adjustment) — never edited directly.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {skus.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No SKUs yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium text-right">Buffer</th>
                <th className="px-4 py-2 font-medium text-right">In stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {skus.map((s) => {
                const stock = stockBySku[s.id] ?? 0
                const low = stock <= s.buffer_stock
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{s.sku}</td>
                    <td className="px-4 py-2.5 text-slate-500">{s.title}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{s.buffer_stock}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${low ? 'text-red-600' : 'text-slate-700'}`}>{stock}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
