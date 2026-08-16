import { useEffect, useState } from 'react'
import { format, subDays, startOfDay } from 'date-fns'
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatINR } from '../lib/format'
import Skeleton from '../components/Skeleton'
import type { Enums } from '../lib/database.types'

const TERMINAL_STATUSES: Enums<'order_status'>[] = ['delivered', 'cancelled', 'returned', 'rto']
const TREND_DAYS = 14

const STATUS_LABEL: Record<Enums<'order_status'>, string> = {
  new: 'New',
  confirmed: 'Confirmed',
  inventory_allocated: 'Allocated',
  partially_allocated: 'Partial Alloc.',
  stock_shortage: 'Shortage',
  ready_to_pick: 'Ready to Pick',
  picked: 'Picked',
  packed: 'Packed',
  ready_to_ship: 'Ready to Ship',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
  rto: 'RTO',
}

interface OrderKpis {
  total: number
  new: number
  processing: number
  readyToPick: number
  picked: number
  packed: number
  readyToShip: number
  shipped: number
  delivered: number
  cancelled: number
}

interface OpsKpis {
  pendingPick: number
  pendingPack: number
  pendingDispatch: number
  slaBreaches: number
  rto: number
  customerReturns: number
}

interface InventoryKpis {
  totalSkus: number
  availableStock: number
  allocatedStock: number
  lowStock: number
  outOfStock: number
}

interface FinancialKpis {
  todaySales: number
  pendingReconciliation: number
  pendingSettlement: number
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [orderKpis, setOrderKpis] = useState<OrderKpis | null>(null)
  const [opsKpis, setOpsKpis] = useState<OpsKpis | null>(null)
  const [invKpis, setInvKpis] = useState<InventoryKpis | null>(null)
  const [finKpis, setFinKpis] = useState<FinancialKpis | null>(null)
  const [statusChart, setStatusChart] = useState<{ status: string; count: number }[]>([])
  const [salesTrend, setSalesTrend] = useState<{ date: string; sales: number }[]>([])
  const [channelChart, setChannelChart] = useState<{ channel: string; orders: number }[]>([])
  const [warehouseChart, setWarehouseChart] = useState<{ warehouse: string; orders: number }[]>([])
  const [returnsTrend, setReturnsTrend] = useState<{ date: string; returns: number; rto: number }[]>([])
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function load() {
    setLoading(true)
    const [
      { data: orders },
      { data: lineItems },
      { data: skus },
      { data: ledger },
      { data: reconEntries },
      { data: returns },
      { data: statusHistory },
      { data: channels },
      { data: warehouses },
    ] = await Promise.all([
      supabase.from('orders').select('id, order_status, gross_amount, order_date, sla_due_at, channel_id'),
      supabase.from('order_line_items').select('order_id, sku_id, allocated_qty, warehouse_id'),
      supabase.from('skus').select('id, buffer_stock, active').eq('active', true),
      supabase.from('inventory_ledger').select('sku_id, quantity_delta'),
      supabase.from('reconciliation_entries').select('status, expected_settlement, actual_settlement'),
      supabase.from('order_returns').select('created_at, return_type'),
      supabase.from('order_status_history').select('new_status, changed_at'),
      supabase.from('channels').select('id, display_name'),
      supabase.from('warehouses').select('id, name'),
    ])

    const ordersData = orders ?? []
    const now = Date.now()
    const today = startOfDay(new Date())

    // ── Order KPIs ──────────────────────────────────────────────────────
    const count = (statuses: Enums<'order_status'>[]) => ordersData.filter((o) => statuses.includes(o.order_status)).length
    setOrderKpis({
      total: ordersData.length,
      new: count(['new']),
      processing: count(['confirmed', 'inventory_allocated', 'partially_allocated', 'stock_shortage']),
      readyToPick: count(['ready_to_pick']),
      picked: count(['picked']),
      packed: count(['packed']),
      readyToShip: count(['ready_to_ship']),
      shipped: count(['shipped']),
      delivered: count(['delivered']),
      cancelled: count(['cancelled']),
    })

    // ── Operational KPIs ────────────────────────────────────────────────
    const openStatuses = (Object.keys(STATUS_LABEL) as Enums<'order_status'>[]).filter((s) => !TERMINAL_STATUSES.includes(s))
    const slaBreaches = ordersData.filter((o) => o.sla_due_at && openStatuses.includes(o.order_status) && new Date(o.sla_due_at).getTime() < now).length
    setOpsKpis({
      pendingPick: count(['ready_to_pick']),
      pendingPack: count(['picked']),
      pendingDispatch: count(['ready_to_ship']),
      slaBreaches,
      rto: count(['rto']),
      customerReturns: (returns ?? []).filter((r) => r.return_type === 'customer_return').length,
    })

    // ── Inventory KPIs ──────────────────────────────────────────────────
    const stockBySku: Record<string, number> = {}
    for (const row of ledger ?? []) stockBySku[row.sku_id] = (stockBySku[row.sku_id] ?? 0) + row.quantity_delta
    const allocatedBySku: Record<string, number> = {}
    const openOrderIds = new Set(ordersData.filter((o) => !TERMINAL_STATUSES.includes(o.order_status)).map((o) => o.id))
    let totalAllocated = 0
    for (const li of lineItems ?? []) {
      if (!openOrderIds.has(li.order_id)) continue
      allocatedBySku[li.sku_id] = (allocatedBySku[li.sku_id] ?? 0) + li.allocated_qty
      totalAllocated += li.allocated_qty
    }
    const totalPhysical = Object.values(stockBySku).reduce((s, v) => s + v, 0)
    const lowStock = (skus ?? []).filter((s) => (stockBySku[s.id] ?? 0) <= s.buffer_stock && (stockBySku[s.id] ?? 0) > 0).length
    const outOfStock = (skus ?? []).filter((s) => (stockBySku[s.id] ?? 0) <= 0).length
    setInvKpis({
      totalSkus: (skus ?? []).length,
      availableStock: Math.max(totalPhysical - totalAllocated, 0),
      allocatedStock: totalAllocated,
      lowStock,
      outOfStock,
    })

    // ── Financial KPIs ──────────────────────────────────────────────────
    const todaySales = ordersData.filter((o) => new Date(o.order_date) >= today).reduce((s, o) => s + Number(o.gross_amount), 0)
    const pendingReconciliation = (reconEntries ?? []).filter((r) => r.status === 'pending_review').length
    const pendingSettlement = (reconEntries ?? []).filter((r) => r.actual_settlement == null).reduce((s, r) => s + Number(r.expected_settlement), 0)
    setFinKpis({ todaySales, pendingReconciliation, pendingSettlement })

    // ── Charts ──────────────────────────────────────────────────────────
    const statusCounts: Record<string, number> = {}
    for (const o of ordersData) statusCounts[o.order_status] = (statusCounts[o.order_status] ?? 0) + 1
    setStatusChart(Object.entries(statusCounts).map(([status, c]) => ({ status: STATUS_LABEL[status as Enums<'order_status'>] ?? status, count: c })))

    const days = Array.from({ length: TREND_DAYS }).map((_, i) => startOfDay(subDays(new Date(), TREND_DAYS - 1 - i)))
    setSalesTrend(
      days.map((d) => ({
        date: format(d, 'dd MMM'),
        sales: ordersData.filter((o) => startOfDay(new Date(o.order_date)).getTime() === d.getTime()).reduce((s, o) => s + Number(o.gross_amount), 0),
      }))
    )

    const channelCounts: Record<string, number> = {}
    for (const o of ordersData) channelCounts[o.channel_id] = (channelCounts[o.channel_id] ?? 0) + 1
    setChannelChart((channels ?? []).map((c) => ({ channel: c.display_name, orders: channelCounts[c.id] ?? 0 })))

    const orderWarehouses: Record<string, Set<string>> = {}
    for (const li of lineItems ?? []) {
      if (!li.warehouse_id) continue
      orderWarehouses[li.warehouse_id] = orderWarehouses[li.warehouse_id] ?? new Set()
      orderWarehouses[li.warehouse_id].add(li.order_id)
    }
    setWarehouseChart((warehouses ?? []).map((w) => ({ warehouse: w.name, orders: orderWarehouses[w.id]?.size ?? 0 })))

    setReturnsTrend(
      days.map((d) => ({
        date: format(d, 'dd MMM'),
        returns: (returns ?? []).filter((r) => startOfDay(new Date(r.created_at)).getTime() === d.getTime() && r.return_type === 'customer_return').length,
        rto: (statusHistory ?? []).filter((h) => h.new_status === 'rto' && startOfDay(new Date(h.changed_at)).getTime() === d.getTime()).length,
      }))
    )

    setLoading(false)
  }

  if (loading || !orderKpis || !opsKpis || !invKpis || !finKpis) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <h2 className="text-xl font-semibold text-slate-900 mb-6">Dashboard</h2>
        <Skeleton rows={6} />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">Dashboard</h2>
        <p className="text-xs text-slate-400 mt-0.5">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
      </div>

      <Section title="Order status">
        <KpiGrid>
          <Kpi label="Total Orders" value={orderKpis.total} />
          <Kpi label="New" value={orderKpis.new} accent="slate" />
          <Kpi label="Processing" value={orderKpis.processing} accent="sky" />
          <Kpi label="Ready to Pick" value={orderKpis.readyToPick} accent="purple" />
          <Kpi label="Picked" value={orderKpis.picked} accent="purple" />
          <Kpi label="Packed" value={orderKpis.packed} accent="blue" />
          <Kpi label="Ready to Ship" value={orderKpis.readyToShip} accent="blue" />
          <Kpi label="Shipped" value={orderKpis.shipped} accent="cyan" />
          <Kpi label="Delivered" value={orderKpis.delivered} accent="emerald" />
          <Kpi label="Cancelled" value={orderKpis.cancelled} accent="slate" />
        </KpiGrid>
      </Section>

      <Section title="Operational">
        <KpiGrid>
          <Kpi label="Pending Pick" value={opsKpis.pendingPick} accent="amber" />
          <Kpi label="Pending Pack" value={opsKpis.pendingPack} accent="amber" />
          <Kpi label="Pending Dispatch" value={opsKpis.pendingDispatch} accent="amber" />
          <Kpi label="SLA Breaches" value={opsKpis.slaBreaches} accent={opsKpis.slaBreaches > 0 ? 'red' : undefined} />
          <Kpi label="NDR" value="—" hint="Not tracked yet — no courier NDR feed wired up" />
          <Kpi label="RTO" value={opsKpis.rto} accent="red" />
          <Kpi label="Customer Returns" value={opsKpis.customerReturns} accent="red" />
        </KpiGrid>
      </Section>

      <Section title="Inventory">
        <KpiGrid>
          <Kpi label="Total SKUs" value={invKpis.totalSkus} />
          <Kpi label="Available Stock" value={invKpis.availableStock} accent="emerald" />
          <Kpi label="Allocated Stock" value={invKpis.allocatedStock} accent="indigo" />
          <Kpi label="Low Stock" value={invKpis.lowStock} accent={invKpis.lowStock > 0 ? 'amber' : undefined} />
          <Kpi label="Out of Stock" value={invKpis.outOfStock} accent={invKpis.outOfStock > 0 ? 'red' : undefined} />
        </KpiGrid>
      </Section>

      <Section title="Financial / Settlement">
        <KpiGrid>
          <Kpi label="Today's Sales" value={formatINR(finKpis.todaySales)} accent="indigo" />
          <Kpi label="Pending Reconciliation" value={finKpis.pendingReconciliation} accent="amber" />
          <Kpi label="Pending Settlement" value={formatINR(finKpis.pendingSettlement)} accent="amber" />
        </KpiGrid>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ChartCard title="Orders by status">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={statusChart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="status" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Sales trend (last 14 days)">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={salesTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatINR(Number(v))} />
              <Line type="monotone" dataKey="sales" stroke="#6366f1" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Channel-wise orders">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={channelChart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="channel" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="orders" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Warehouse-wise orders">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={warehouseChart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="warehouse" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="orders" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Returns / RTO trend (last 14 days)" full>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={returnsTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="returns" name="Customer returns" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="rto" name="RTO" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">{title}</h3>
      {children}
    </div>
  )
}

function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">{children}</div>
}

const ACCENTS = {
  indigo: 'from-indigo-500 to-indigo-600',
  purple: 'from-purple-500 to-purple-600',
  amber: 'from-amber-500 to-amber-600',
  red: 'from-red-500 to-red-600',
  emerald: 'from-emerald-500 to-emerald-600',
  slate: 'from-slate-400 to-slate-500',
  sky: 'from-sky-500 to-sky-600',
  blue: 'from-blue-500 to-blue-600',
  cyan: 'from-cyan-500 to-cyan-600',
} as const

function Kpi({ label, value, accent, hint }: { label: string; value: string | number; accent?: keyof typeof ACCENTS; hint?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 relative overflow-hidden" title={hint}>
      {accent && <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${ACCENTS[accent]}`} />}
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-lg font-semibold mt-0.5 text-slate-900">{value}</div>
    </div>
  )
}

function ChartCard({ title, children, full }: { title: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 ${full ? 'lg:col-span-2' : ''}`}>
      <div className="text-xs font-semibold uppercase text-slate-500 mb-3">{title}</div>
      {children}
    </div>
  )
}
