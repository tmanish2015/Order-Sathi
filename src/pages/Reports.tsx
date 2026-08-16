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

const TABS = ['Sales', 'Orders', 'Inventory', 'Shipping', 'Returns', 'Reconciliation', 'Profitability'] as const
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
  const [ledger, setLedger] = useState<{ sku_id: string; quantity_delta: number }[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [returns, setReturns] = useState<Return[]>([])
  const [settlements, setSettlements] = useState<SettlementTxn[]>([])

  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      setLoading(true)
      const [{ data: o }, { data: li }, { data: s }, { data: c }, { data: l }, { data: sh }, { data: r }, { data: st }] = await Promise.all([
        supabase.from('orders').select('*'),
        supabase.from('order_line_items').select('*, skus(*)'),
        supabase.from('skus').select('*'),
        supabase.from('channels').select('*'),
        supabase.from('inventory_ledger').select('sku_id, quantity_delta'),
        supabase.from('shipments').select('*'),
        supabase.from('order_returns').select('*'),
        supabase.from('settlement_transactions').select('*'),
      ])
      setOrders(o ?? [])
      setLineItems((li as unknown as LineItem[]) ?? [])
      setSkus(s ?? [])
      setChannels(c ?? [])
      setLedger(l ?? [])
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
