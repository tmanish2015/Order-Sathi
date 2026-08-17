import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, subDays, startOfDay } from 'date-fns'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatINR } from '../lib/format'
import Skeleton from '../components/Skeleton'
import type { Tables, Enums } from '../lib/database.types'

type Order = Tables<'orders'>
type LineItem = Tables<'order_line_items'> & { skus: Tables<'skus'> | null }
type Sku = Tables<'skus'>
type Channel = Tables<'channels'>
type Shipment = Tables<'shipments'>
type Return = Tables<'order_returns'>
type SettlementTxn = Tables<'settlement_transactions'>
type Warehouse = Tables<'warehouses'>
type LedgerRow = { sku_id: string; warehouse_id: string; quantity_delta: number; created_at: string; movement_type: Enums<'inventory_movement_type'> }

const TABS = ['Sales', 'Orders', 'Inventory', 'Ageing', 'ABC/FSN', 'Shipping', 'Returns', 'Reconciliation', 'Profitability'] as const
type Tab = (typeof TABS)[number]

const TREND_DAYS = 30

export default function Reports() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('Sales')
  const [loading, setLoading] = useState(true)

  const [orders, setOrders] = useState<Order[]>([])
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [skus, setSkus] = useState<Sku[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [returns, setReturns] = useState<Return[]>([])
  const [settlements, setSettlements] = useState<SettlementTxn[]>([])

  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      setLoading(true)
      const [{ data: o }, { data: li }, { data: s }, { data: c }, { data: l }, { data: w }, { data: sh }, { data: r }, { data: st }] = await Promise.all([
        supabase.from('orders').select('*'),
        supabase.from('order_line_items').select('*, skus(*)'),
        supabase.from('skus').select('*'),
        supabase.from('channels').select('*'),
        supabase.from('inventory_ledger').select('sku_id, warehouse_id, quantity_delta, created_at, movement_type'),
        supabase.from('warehouses').select('*'),
        supabase.from('shipments').select('*'),
        supabase.from('order_returns').select('*'),
        supabase.from('settlement_transactions').select('*'),
      ])
      setOrders(o ?? [])
      setLineItems((li as unknown as LineItem[]) ?? [])
      setSkus(s ?? [])
      setChannels(c ?? [])
      setLedger(l ?? [])
      setWarehouses(w ?? [])
      setShipments(sh ?? [])
      setReturns(r ?? [])
      setSettlements(st ?? [])
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Reports &amp; Analytics</h2>
      <p className="text-xs text-slate-400 mb-4">Every number below comes from live data — nothing here is a static placeholder.</p>

      <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
              tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton rows={5} />
      ) : (
        <>
          {tab === 'Sales' && <SalesReport orders={orders} channels={channels} />}
          {tab === 'Orders' && <OrdersReport orders={orders} />}
          {tab === 'Inventory' && <InventoryReport skus={skus} ledger={ledger} lineItems={lineItems} orders={orders} />}
          {tab === 'Ageing' && <AgeingReport skus={skus} ledger={ledger} warehouses={warehouses} />}
          {tab === 'ABC/FSN' && <AbcFsnReport skus={skus} lineItems={lineItems} ledger={ledger} warehouses={warehouses} />}
          {tab === 'Shipping' && <ShippingReport shipments={shipments} />}
          {tab === 'Returns' && <ReturnsReport returns={returns} />}
          {tab === 'Reconciliation' && <ReconciliationReport settlements={settlements} />}
          {tab === 'Profitability' && <ProfitabilityReport orders={orders} lineItems={lineItems} />}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg font-semibold mt-1 text-slate-900">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
              {headers.map((h) => (
                <th key={h} className="px-4 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="px-4 py-6 text-center text-slate-400 text-sm">
                  No data yet.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-2.5 text-slate-600">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SalesReport({ orders, channels }: { orders: Order[]; channels: Channel[] }) {
  const days = Array.from({ length: TREND_DAYS }).map((_, i) => startOfDay(subDays(new Date(), TREND_DAYS - 1 - i)))
  const trend = days.map((d) => ({
    date: format(d, 'dd MMM'),
    sales: orders.filter((o) => startOfDay(new Date(o.order_date)).getTime() === d.getTime()).reduce((s, o) => s + Number(o.gross_amount), 0),
  }))
  const totalRevenue = orders.reduce((s, o) => s + Number(o.gross_amount), 0)
  const aov = orders.length > 0 ? totalRevenue / orders.length : 0

  const byChannel = channels.map((c) => {
    const channelOrders = orders.filter((o) => o.channel_id === c.id)
    const revenue = channelOrders.reduce((s, o) => s + Number(o.gross_amount), 0)
    return [c.display_name, channelOrders.length, formatINR(revenue), formatINR(channelOrders.length > 0 ? revenue / channelOrders.length : 0)]
  })

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Total orders" value={orders.length} />
        <Stat label="Total revenue" value={formatINR(totalRevenue)} />
        <Stat label="Average order value" value={formatINR(aov)} />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="text-xs font-semibold uppercase text-slate-500 mb-3">Sales trend (last 30 days)</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={2} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => formatINR(Number(v))} />
            <Bar dataKey="sales" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Sales by channel</div>
        <Table headers={['Channel', 'Orders', 'Revenue', 'AOV']} rows={byChannel} />
      </div>
    </div>
  )
}

function OrdersReport({ orders }: { orders: Order[] }) {
  const total = orders.length
  const counts: Record<string, number> = {}
  for (const o of orders) counts[o.order_status] = (counts[o.order_status] ?? 0) + 1
  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => [status.replace(/_/g, ' '), count, total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '—'])

  const openStatuses: Enums<'order_status'>[] = ['new', 'confirmed', 'inventory_allocated', 'partially_allocated', 'stock_shortage', 'ready_to_pick', 'picked', 'packed', 'ready_to_ship']
  const now = Date.now()
  const withSla = orders.filter((o) => o.sla_due_at)
  const breached = withSla.filter((o) => openStatuses.includes(o.order_status) && new Date(o.sla_due_at!).getTime() < now).length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Total orders" value={total} />
        <Stat label="Orders with SLA set" value={withSla.length} />
        <Stat label="SLA breaches (open orders)" value={breached} sub={withSla.length > 0 ? `${((breached / withSla.length) * 100).toFixed(1)}% of SLA orders` : undefined} />
      </div>
      <div>
        <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Order status breakdown</div>
        <Table headers={['Status', 'Count', '% of total']} rows={rows} />
      </div>
    </div>
  )
}

function InventoryReport({ skus, ledger, lineItems, orders }: { skus: Sku[]; ledger: { sku_id: string; quantity_delta: number }[]; lineItems: LineItem[]; orders: Order[] }) {
  const TERMINAL: Enums<'order_status'>[] = ['delivered', 'cancelled', 'returned', 'rto']
  const openOrderIds = new Set(orders.filter((o) => !TERMINAL.includes(o.order_status)).map((o) => o.id))

  const stockBySku: Record<string, number> = {}
  for (const row of ledger) stockBySku[row.sku_id] = (stockBySku[row.sku_id] ?? 0) + row.quantity_delta
  const allocatedBySku: Record<string, number> = {}
  for (const li of lineItems) {
    if (!openOrderIds.has(li.order_id)) continue
    allocatedBySku[li.sku_id] = (allocatedBySku[li.sku_id] ?? 0) + li.allocated_qty
  }

  const rows = skus
    .map((s) => {
      const physical = stockBySku[s.id] ?? 0
      const allocated = allocatedBySku[s.id] ?? 0
      const available = Math.max(physical - allocated, 0)
      return { sku: s, physical, allocated, available }
    })
    .sort((a, b) => a.available - b.available)

  const totalStockValue = rows.reduce((sum, r) => sum + r.physical * Number(r.sku.cost_price), 0)
  const lowStock = rows.filter((r) => r.available <= r.sku.buffer_stock && r.available > 0).length
  const outOfStock = rows.filter((r) => r.available <= 0).length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total SKUs" value={skus.length} />
        <Stat label="Stock value (at cost)" value={formatINR(totalStockValue)} />
        <Stat label="Low stock" value={lowStock} />
        <Stat label="Out of stock" value={outOfStock} />
      </div>
      <Table
        headers={['SKU', 'Physical', 'Allocated', 'Available', 'Buffer']}
        rows={rows.map((r) => [r.sku.sku, r.physical, r.allocated, r.available, r.sku.buffer_stock])}
      />
    </div>
  )
}

const AGE_BUCKETS = ['0–30 days', '31–60 days', '61–90 days', '91–180 days', '181–365 days', '365+ days'] as const

function ageBucket(days: number): (typeof AGE_BUCKETS)[number] {
  if (days <= 30) return AGE_BUCKETS[0]
  if (days <= 60) return AGE_BUCKETS[1]
  if (days <= 90) return AGE_BUCKETS[2]
  if (days <= 180) return AGE_BUCKETS[3]
  if (days <= 365) return AGE_BUCKETS[4]
  return AGE_BUCKETS[5]
}

const INBOUND_MOVEMENT_TYPES: Enums<'inventory_movement_type'>[] = ['restock', 'transfer_in', 'return']
type AgeSort = 'oldest' | 'value' | 'qty'

function AgeingReport({ skus, ledger, warehouses }: { skus: Sku[]; ledger: LedgerRow[]; warehouses: Warehouse[] }) {
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [search, setSearch] = useState('')
  const [bucketFilter, setBucketFilter] = useState('')
  const [sortBy, setSortBy] = useState<AgeSort>('oldest')

  const skuById = new Map(skus.map((s) => [s.id, s]))
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]))

  // "Oldest stock date" is approximated as this SKU/warehouse pair's most
  // recent INBOUND movement (restock / transfer-in / return) - the actual
  // remaining units could be older if only part of that inbound has sold,
  // but without per-lot/batch receipt tracking (a separate Phase 3 item)
  // this is the best signal the existing ledger can give, and it's never
  // reset by an outbound sale the way "any movement" would be.
  const byPair = new Map<string, { skuId: string; warehouseId: string; qty: number; lastInbound: string | null }>()
  for (const row of ledger) {
    const key = `${row.sku_id}:${row.warehouse_id}`
    const existing = byPair.get(key) ?? { skuId: row.sku_id, warehouseId: row.warehouse_id, qty: 0, lastInbound: null }
    existing.qty += row.quantity_delta
    if (INBOUND_MOVEMENT_TYPES.includes(row.movement_type) && (!existing.lastInbound || row.created_at > existing.lastInbound)) {
      existing.lastInbound = row.created_at
    }
    byPair.set(key, existing)
  }

  const now = Date.now()
  let rows = Array.from(byPair.values())
    .filter((p) => p.qty > 0 && p.lastInbound)
    .map((p) => {
      const sku = skuById.get(p.skuId)
      const warehouse = warehouseById.get(p.warehouseId)
      const ageDays = Math.floor((now - new Date(p.lastInbound!).getTime()) / (24 * 60 * 60 * 1000))
      const value = p.qty * Number(sku?.cost_price ?? 0)
      return { sku, warehouse, warehouseId: p.warehouseId, qty: p.qty, value, ageDays, bucket: ageBucket(ageDays), lastInbound: p.lastInbound! }
    })
    .filter((r): r is typeof r & { sku: Sku } => !!r.sku)

  if (warehouseFilter) rows = rows.filter((r) => r.warehouseId === warehouseFilter)
  if (bucketFilter) rows = rows.filter((r) => r.bucket === bucketFilter)
  if (search.trim()) {
    const q = search.trim().toLowerCase()
    rows = rows.filter((r) => r.sku.sku.toLowerCase().includes(q) || r.sku.title.toLowerCase().includes(q))
  }
  rows = rows.sort((a, b) => (sortBy === 'oldest' ? b.ageDays - a.ageDays : sortBy === 'value' ? b.value - a.value : b.qty - a.qty))

  const bucketCounts: Record<string, number> = {}
  const bucketValue: Record<string, number> = {}
  for (const r of rows) {
    bucketCounts[r.bucket] = (bucketCounts[r.bucket] ?? 0) + 1
    bucketValue[r.bucket] = (bucketValue[r.bucket] ?? 0) + r.value
  }
  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  const oldest = rows.length > 0 ? Math.max(...rows.map((r) => r.ageDays)) : 0
  const slowMoving = rows.filter((r) => r.bucket === AGE_BUCKETS[4] || r.bucket === AGE_BUCKETS[5]).length

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-400">
        Age is based on each SKU/warehouse pair's most recent inbound movement (restock / transfer-in / return), not SKU creation date.
        Without per-lot receipt tracking this is an approximation of "oldest stock" — see the ageing note above.
      </p>
      <div className="flex flex-wrap gap-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU or title…" className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 w-48" />
        {warehouses.length > 1 && (
          <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5">
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <select value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value)} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5">
          <option value="">All buckets</option>
          {AGE_BUCKETS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as AgeSort)} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5">
          <option value="oldest">Sort: oldest first</option>
          <option value="value">Sort: highest value</option>
          <option value="qty">Sort: highest quantity</option>
        </select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total quantity" value={totalQty} />
        <Stat label="Total inventory value" value={formatINR(totalValue)} />
        <Stat label="Oldest inventory" value={`${oldest}d`} />
        <Stat label="Slow-moving lines (181d+)" value={slowMoving} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {AGE_BUCKETS.map((b) => (
          <Stat key={b} label={b} value={bucketCounts[b] ?? 0} sub={formatINR(bucketValue[b] ?? 0)} />
        ))}
      </div>
      <Table
        headers={['SKU', 'Product', 'Warehouse', 'Quantity', 'Stock value', 'Age (days)', 'Last inbound', 'Bucket']}
        rows={rows.map((r) => [
          r.sku.sku,
          r.sku.title,
          r.warehouse?.name ?? '—',
          r.qty,
          formatINR(r.value),
          r.ageDays,
          format(new Date(r.lastInbound), 'dd MMM yyyy'),
          r.bucket,
        ])}
      />
    </div>
  )
}

const FSN_WINDOW_DAYS_DEFAULT = 30
const FAST_MOVING_RATE = 1

function AbcFsnReport({
  skus,
  lineItems,
  ledger,
  warehouses,
}: {
  skus: Sku[]
  lineItems: LineItem[]
  ledger: LedgerRow[]
  warehouses: Warehouse[]
}) {
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [windowDays, setWindowDays] = useState(FSN_WINDOW_DAYS_DEFAULT)

  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000

  // ABC: revenue contribution over the window, Pareto cut at 80% / 95%.
  const revenueBySku: Record<string, number> = {}
  for (const li of lineItems) {
    if (warehouseFilter && li.warehouse_id !== warehouseFilter) continue
    if (new Date(li.created_at).getTime() < cutoff) continue
    revenueBySku[li.sku_id] = (revenueBySku[li.sku_id] ?? 0) + li.quantity * Number(li.unit_price)
  }
  const totalRevenue = Object.values(revenueBySku).reduce((a, b) => a + b, 0)
  const rankedByRevenue = skus
    .map((s) => ({ sku: s, revenue: revenueBySku[s.id] ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue)
  let cumulative = 0
  const abcBySku: Record<string, 'A' | 'B' | 'C'> = {}
  for (const r of rankedByRevenue) {
    cumulative += r.revenue
    const cumPct = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 100
    abcBySku[r.sku.id] = r.revenue <= 0 ? 'C' : cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C'
  }

  // FSN: units sold per day over the window, from order_deduction movements only.
  const unitsBySku: Record<string, number> = {}
  for (const row of ledger) {
    if (row.movement_type !== 'order_deduction') continue
    if (warehouseFilter && row.warehouse_id !== warehouseFilter) continue
    if (new Date(row.created_at).getTime() < cutoff) continue
    unitsBySku[row.sku_id] = (unitsBySku[row.sku_id] ?? 0) + -row.quantity_delta
  }
  const fsnBySku: Record<string, 'Fast' | 'Slow' | 'Non'> = {}
  for (const s of skus) {
    const rate = (unitsBySku[s.id] ?? 0) / windowDays
    fsnBySku[s.id] = rate >= FAST_MOVING_RATE ? 'Fast' : rate > 0 ? 'Slow' : 'Non'
  }

  const abcCounts = { A: 0, B: 0, C: 0 }
  const fsnCounts = { Fast: 0, Slow: 0, Non: 0 }
  for (const s of skus) {
    abcCounts[abcBySku[s.id]]++
    fsnCounts[fsnBySku[s.id]]++
  }

  const rows = skus
    .map((s) => ({ sku: s, revenue: revenueBySku[s.id] ?? 0, units: unitsBySku[s.id] ?? 0, abc: abcBySku[s.id], fsn: fsnBySku[s.id] }))
    .sort((a, b) => b.revenue - a.revenue)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {warehouses.length > 1 && (
          <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5">
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5">
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <span className="text-xs text-slate-400 self-center">Category/brand filters need the catalog fields from a later Phase 3 task.</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="A (top 80% revenue)" value={abcCounts.A} />
        <Stat label="B (next 15%)" value={abcCounts.B} />
        <Stat label="C (remaining 5% + zero)" value={abcCounts.C} />
        <Stat label="Fast moving" value={fsnCounts.Fast} />
        <Stat label="Slow moving" value={fsnCounts.Slow} />
        <Stat label="Non moving" value={fsnCounts.Non} />
      </div>

      <Table
        headers={['SKU', 'Revenue', 'Units sold', 'ABC', 'FSN']}
        rows={rows.map((r) => [r.sku.sku, formatINR(r.revenue), r.units, r.abc, r.fsn])}
      />
    </div>
  )
}

function ShippingReport({ shipments }: { shipments: Shipment[] }) {
  const byCourier: Record<string, Record<string, number>> = {}
  for (const s of shipments) {
    byCourier[s.courier_name] = byCourier[s.courier_name] ?? {}
    byCourier[s.courier_name][s.status] = (byCourier[s.courier_name][s.status] ?? 0) + 1
  }
  const statuses = Array.from(new Set(shipments.map((s) => s.status)))
  const rows = Object.entries(byCourier).map(([courier, counts]) => [
    courier,
    Object.values(counts).reduce((a, b) => a + b, 0),
    ...statuses.map((st) => counts[st] ?? 0),
  ])
  const delivered = shipments.filter((s) => s.status === 'delivered').length
  const rto = shipments.filter((s) => s.status === 'rto').length
  const ndr = shipments.filter((s) => s.status === 'ndr').length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total shipments" value={shipments.length} />
        <Stat label="Delivered" value={delivered} />
        <Stat label="RTO" value={rto} />
        <Stat label="NDR" value={ndr} />
      </div>
      <div>
        <div className="text-xs font-semibold uppercase text-slate-500 mb-2">By courier</div>
        <Table headers={['Courier', 'Total', ...statuses.map((s) => s.replace(/_/g, ' '))]} rows={rows} />
      </div>
    </div>
  )
}

function ReturnsReport({ returns }: { returns: Return[] }) {
  const customerReturns = returns.filter((r) => r.return_type === 'customer_return').length
  const rto = returns.filter((r) => r.return_type === 'rto').length

  const byOutcome: Record<string, number> = {}
  for (const r of returns) {
    const key = r.qc_outcome ?? 'not QC’d yet'
    byOutcome[key] = (byOutcome[key] ?? 0) + 1
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Total returns" value={returns.length} />
        <Stat label="Customer returns" value={customerReturns} />
        <Stat label="RTO" value={rto} />
      </div>
      <div>
        <div className="text-xs font-semibold uppercase text-slate-500 mb-2">QC outcome breakdown</div>
        <Table headers={['Outcome', 'Count']} rows={Object.entries(byOutcome).map(([k, v]) => [k.replace(/_/g, ' '), v])} />
      </div>
    </div>
  )
}

function ReconciliationReport({ settlements }: { settlements: SettlementTxn[] }) {
  const byStatus: Record<string, number> = {}
  for (const s of settlements) byStatus[s.match_status] = (byStatus[s.match_status] ?? 0) + 1

  const gross = settlements.reduce((s, t) => s + Number(t.gross_amount), 0)
  const fees = settlements.reduce((s, t) => s + Number(t.fees), 0)
  const taxes = settlements.reduce((s, t) => s + Number(t.taxes), 0)
  const refunds = settlements.reduce((s, t) => s + Number(t.refunds), 0)
  const net = settlements.reduce((s, t) => s + Number(t.net_amount), 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Gross" value={formatINR(gross)} />
        <Stat label="Fees" value={formatINR(fees)} />
        <Stat label="Taxes" value={formatINR(taxes)} />
        <Stat label="Refunds" value={formatINR(refunds)} />
        <Stat label="Net settlement" value={formatINR(net)} />
      </div>
      <div>
        <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Match status breakdown</div>
        <Table headers={['Status', 'Count']} rows={Object.entries(byStatus).map(([k, v]) => [k.replace(/_/g, ' '), v])} />
      </div>
    </div>
  )
}

function ProfitabilityReport({ orders, lineItems }: { orders: Order[]; lineItems: LineItem[] }) {
  const revenue = orders.reduce((s, o) => s + Number(o.gross_amount), 0)
  const cogs = lineItems.reduce((s, li) => s + li.quantity * Number(li.skus?.cost_price ?? 0), 0)
  const grossMargin = revenue - cogs

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Revenue" value={formatINR(revenue)} />
        <Stat label="COGS" value={formatINR(cogs)} />
        <Stat label="Gross margin" value={formatINR(grossMargin)} sub={revenue > 0 ? `${((grossMargin / revenue) * 100).toFixed(1)}%` : undefined} />
      </div>
      <p className="text-xs text-slate-400">
        Net profit (after Amazon fees, per order) is tracked in detail on the{' '}
        <Link to="/profit" className="text-indigo-600 hover:underline">
          Profit &amp; Loss
        </Link>{' '}
        page, since it depends on MTR reconciliation being imported per order.
      </p>
    </div>
  )
}
