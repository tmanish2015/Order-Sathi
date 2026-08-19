import { useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'

type Row = Record<string, string | number | boolean | null>

interface Dataset {
  key: string
  label: string
  fetch: (from: string | null, to: string | null) => Promise<Row[]>
}

function downloadCsv(filename: string, rows: Row[]) {
  const csv = Papa.unparse(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function dateFilter(query: ReturnType<typeof supabase.from>, column: string, from: string | null, to: string | null) {
  let q = query
  if (from) q = q.gte(column, from)
  if (to) q = q.lte(column, to)
  return q
}

const DATASETS: Dataset[] = [
  {
    key: 'orders',
    label: 'Orders',
    fetch: async (from, to) => {
      const { data } = await dateFilter(supabase.from('orders').select('amazon_order_id, order_date, order_status, customer_name, payment_type, gross_amount, priority'), 'order_date', from, to)
      return (data ?? []) as Row[]
    },
  },
  {
    key: 'inventory',
    label: 'Inventory',
    fetch: async () => {
      const [{ data: skus }, { data: ledger }] = await Promise.all([
        supabase.from('skus').select('sku, title, category, brand, cost_price, buffer_stock, reorder_level'),
        supabase.from('inventory_ledger').select('sku_id, quantity_delta, skus(sku)'),
      ])
      const stockBySku: Record<string, number> = {}
      for (const row of (ledger ?? []) as unknown as { sku_id: string; quantity_delta: number }[]) {
        stockBySku[row.sku_id] = (stockBySku[row.sku_id] ?? 0) + row.quantity_delta
      }
      const { data: skusWithId } = await supabase.from('skus').select('id, sku')
      const idBySku = new Map((skusWithId ?? []).map((s) => [s.sku, s.id]))
      return (skus ?? []).map((s) => ({ ...s, physical_stock: stockBySku[idBySku.get(s.sku) ?? ''] ?? 0 }))
    },
  },
  {
    key: 'sales',
    label: 'Sales (order line items)',
    fetch: async (from, to) => {
      const { data } = await dateFilter(
        supabase.from('order_line_items').select('created_at, quantity, unit_price, skus(sku), orders(amazon_order_id, order_date)'),
        'created_at',
        from,
        to
      )
      return ((data ?? []) as unknown as { created_at: string; quantity: number; unit_price: number; skus: { sku: string } | null; orders: { amazon_order_id: string; order_date: string } | null }[]).map((r) => ({
        order_id: r.orders?.amazon_order_id ?? '',
        order_date: r.orders?.order_date ?? '',
        sku: r.skus?.sku ?? '',
        quantity: r.quantity,
        unit_price: r.unit_price,
        line_total: r.quantity * r.unit_price,
      }))
    },
  },
  {
    key: 'returns',
    label: 'Returns',
    fetch: async (from, to) => {
      const { data } = await dateFilter(supabase.from('order_returns').select('created_at, return_type, status, quantity, reason, expected_refund, actual_refund, qc_outcome, orders(amazon_order_id)'), 'created_at', from, to)
      return ((data ?? []) as unknown as { orders?: { amazon_order_id: string } | null }[]).map((r) => {
        const { orders, ...rest } = r
        return { ...(rest as Row), order_id: orders?.amazon_order_id ?? '' }
      })
    },
  },
  {
    key: 'settlements',
    label: 'Settlements',
    fetch: async (from, to) => {
      const { data } = await dateFilter(supabase.from('settlement_transactions').select('settlement_id, channel_order_id, gross_amount, fees, taxes, refunds, adjustments, net_amount, settlement_date, match_status'), 'settlement_date', from, to)
      return (data ?? []) as Row[]
    },
  },
  {
    key: 'reconciliation',
    label: 'Reconciliation',
    fetch: async (from, to) => {
      const { data } = await dateFilter(supabase.from('reconciliation_entries').select('created_at, gross_sales, commission, tds_194o, expected_settlement, actual_settlement, status, orders(amazon_order_id)'), 'created_at', from, to)
      return ((data ?? []) as unknown as { orders?: { amazon_order_id: string } | null }[]).map((r) => {
        const { orders, ...rest } = r
        return { ...(rest as Row), order_id: orders?.amazon_order_id ?? '' }
      })
    },
  },
  {
    key: 'shipping',
    label: 'Shipping',
    fetch: async (from, to) => {
      const { data } = await dateFilter(supabase.from('shipments').select('courier_name, awb_number, status, shipped_at, orders(amazon_order_id)'), 'shipped_at', from, to)
      return ((data ?? []) as unknown as { orders?: { amazon_order_id: string } | null }[]).map((r) => {
        const { orders, ...rest } = r
        return { ...(rest as Row), order_id: orders?.amazon_order_id ?? '' }
      })
    },
  },
  {
    key: 'products',
    label: 'Products',
    fetch: async () => {
      const { data } = await supabase.from('skus').select('sku, title, brand, category, hsn_code, gst_rate, cost_price, active, is_bundle')
      return (data ?? []) as Row[]
    },
  },
  {
    key: 'profitability',
    label: 'Profitability (by SKU)',
    fetch: async () => {
      const { data } = await supabase.from('order_line_items').select('quantity, unit_price, skus(sku, title, cost_price)')
      const bySku = new Map<string, { sku: string; title: string; units: number; revenue: number; cogs: number }>()
      for (const li of (data ?? []) as unknown as { quantity: number; unit_price: number; skus: { sku: string; title: string; cost_price: number } | null }[]) {
        if (!li.skus) continue
        const existing = bySku.get(li.skus.sku) ?? { sku: li.skus.sku, title: li.skus.title, units: 0, revenue: 0, cogs: 0 }
        existing.units += li.quantity
        existing.revenue += li.quantity * li.unit_price
        existing.cogs += li.quantity * li.skus.cost_price
        bySku.set(li.skus.sku, existing)
      }
      return Array.from(bySku.values()).map((r) => ({ ...r, gross_profit: r.revenue - r.cogs }))
    },
  },
]

export default function ExportCentre() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [exporting, setExporting] = useState<string | null>(null)

  function toggle(key: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function exportOne(ds: Dataset) {
    setExporting(ds.key)
    try {
      const rows = await ds.fetch(from || null, to || null)
      if (rows.length === 0) {
        showError(`${ds.label}: no rows to export for this range.`)
        return
      }
      downloadCsv(`order-sathi-${ds.key}-${new Date().toISOString().slice(0, 10)}.csv`, rows)
      showSuccess(`${ds.label}: exported ${rows.length} row(s).`)
    } catch (err) {
      reportError(showError, `Export ${ds.label}`, err as { message: string }, profile?.organization_id, profile?.id)
    } finally {
      setExporting(null)
    }
  }

  async function exportSelected() {
    for (const key of selected) {
      const ds = DATASETS.find((d) => d.key === key)
      if (ds) await exportOne(ds)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Export Centre</h2>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        CSV exports of live data (opens fine in Excel/Sheets). Date range applies to datasets with a natural date column; datasets without
        one (Inventory, Products) always export the current full snapshot.
      </p>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 mb-6 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400">From (optional)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5" />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400">To (optional)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5" />
        </label>
        {selected.size > 0 && (
          <button onClick={exportSelected} disabled={exporting != null} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
            Export {selected.size} selected
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
          {DATASETS.map((ds) => (
            <div key={ds.key} className="px-4 py-3 flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={selected.has(ds.key)} onChange={() => toggle(ds.key)} />
                {ds.label}
              </label>
              <button onClick={() => exportOne(ds)} disabled={exporting === ds.key} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                {exporting === ds.key ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
