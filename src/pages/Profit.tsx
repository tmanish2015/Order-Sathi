import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatINR } from '../lib/format'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Order = Tables<'orders'>
type LineItem = Tables<'order_line_items'> & { skus: Tables<'skus'> | null }
type ReconEntry = Tables<'reconciliation_entries'>
type Channel = Tables<'channels'>
type Warehouse = Tables<'warehouses'>

interface OrderRow {
  order: Order
  cogs: number
  fees: number | null // null = no MTR reconciliation yet, fees unknown
  netProfit: number | null
  grossMargin: number
}

interface SkuRollup {
  sku: string
  title: string
  units: number
  revenue: number
  cogs: number
  grossMargin: number
}

interface ChannelRollup {
  name: string
  orders: number
  revenue: number
  cogs: number
  grossProfit: number
  fees: number
  ordersWithFees: number
  contributionProfit: number
}

interface WarehouseRollup {
  name: string
  units: number
  revenue: number
  cogs: number
  grossProfit: number
}

export default function Profit() {
  const { profile } = useAuth()
  const [orderRows, setOrderRows] = useState<OrderRow[]>([])
  const [skuRollups, setSkuRollups] = useState<SkuRollup[]>([])
  const [channelRollups, setChannelRollups] = useState<ChannelRollup[]>([])
  const [warehouseRollups, setWarehouseRollups] = useState<WarehouseRollup[]>([])
  const [loading, setLoading] = useState(true)
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      setLoading(true)
      const [{ data: orders }, { data: lineItems }, { data: entries }, { data: channels }, { data: warehouses }] = await Promise.all([
        supabase.from('orders').select('*').order('order_date', { ascending: false }),
        supabase.from('order_line_items').select('*, skus(*)'),
        supabase.from('reconciliation_entries').select('*'),
        supabase.from('channels').select('*'),
        supabase.from('warehouses').select('*'),
      ])

      const entryByOrderId = new Map((entries as ReconEntry[] ?? []).map((e) => [e.order_id, e]))
      const lineItemsByOrderId = new Map<string, LineItem[]>()
      for (const li of (lineItems as unknown as LineItem[]) ?? []) {
        const list = lineItemsByOrderId.get(li.order_id) ?? []
        list.push(li)
        lineItemsByOrderId.set(li.order_id, list)
      }

      const rows: OrderRow[] = ((orders as Order[]) ?? []).map((order) => {
        const items = lineItemsByOrderId.get(order.id) ?? []
        const cogs = items.reduce((sum, li) => sum + li.quantity * Number(li.skus?.cost_price ?? 0), 0)
        const entry = entryByOrderId.get(order.id)
        const fees = entry ? Number(entry.commission) + Number(entry.tcs_cgst) + Number(entry.tcs_sgst) + Number(entry.tcs_igst) + Number(entry.tds_194o) + Number(entry.other_fees) : null
        const revenue = Number(order.gross_amount)
        return {
          order,
          cogs,
          fees,
          netProfit: fees != null ? revenue - fees - cogs : null,
          grossMargin: revenue - cogs,
        }
      })
      setOrderRows(rows)

      const rollupBySku = new Map<string, SkuRollup>()
      for (const li of (lineItems as unknown as LineItem[]) ?? []) {
        if (!li.skus) continue
        const key = li.skus.id
        const existing = rollupBySku.get(key) ?? { sku: li.skus.sku, title: li.skus.title, units: 0, revenue: 0, cogs: 0, grossMargin: 0 }
        existing.units += li.quantity
        existing.revenue += li.quantity * Number(li.unit_price)
        existing.cogs += li.quantity * Number(li.skus.cost_price)
        existing.grossMargin = existing.revenue - existing.cogs
        rollupBySku.set(key, existing)
      }
      setSkuRollups(Array.from(rollupBySku.values()).sort((a, b) => b.grossMargin - a.grossMargin))

      // Channel contribution profit - fees are known per order (from MTR
      // reconciliation), so this can compute a real contribution profit,
      // not just gross margin.
      const channelById = new Map((channels as Channel[] ?? []).map((c) => [c.id, c.display_name]))
      const rollupByChannel = new Map<string, ChannelRollup>()
      for (const order of (orders as Order[]) ?? []) {
        const key = order.channel_id
        const existing = rollupByChannel.get(key) ?? {
          name: channelById.get(key) ?? 'Unknown channel',
          orders: 0,
          revenue: 0,
          cogs: 0,
          grossProfit: 0,
          fees: 0,
          ordersWithFees: 0,
          contributionProfit: 0,
        }
        const items = lineItemsByOrderId.get(order.id) ?? []
        const cogs = items.reduce((sum, li) => sum + li.quantity * Number(li.skus?.cost_price ?? 0), 0)
        const entry = entryByOrderId.get(order.id)
        const fees = entry ? Number(entry.commission) + Number(entry.tcs_cgst) + Number(entry.tcs_sgst) + Number(entry.tcs_igst) + Number(entry.tds_194o) + Number(entry.other_fees) : null
        existing.orders += 1
        existing.revenue += Number(order.gross_amount)
        existing.cogs += cogs
        existing.grossProfit += Number(order.gross_amount) - cogs
        if (fees != null) {
          existing.fees += fees
          existing.ordersWithFees += 1
          existing.contributionProfit += Number(order.gross_amount) - cogs - fees
        }
        rollupByChannel.set(key, existing)
      }
      setChannelRollups(Array.from(rollupByChannel.values()).sort((a, b) => b.revenue - a.revenue))

      // Warehouse contribution - gross margin only. Amazon fees are
      // per-order from reconciliation, not splittable across a multi-
      // warehouse order's individual lines, so contribution profit isn't
      // shown here (would require fabricating an allocation).
      const warehouseById = new Map((warehouses as Warehouse[] ?? []).map((w) => [w.id, w.name]))
      const rollupByWarehouse = new Map<string, WarehouseRollup>()
      for (const li of (lineItems as unknown as LineItem[]) ?? []) {
        if (!li.warehouse_id) continue
        const key = li.warehouse_id
        const existing = rollupByWarehouse.get(key) ?? { name: warehouseById.get(key) ?? 'Unknown warehouse', units: 0, revenue: 0, cogs: 0, grossProfit: 0 }
        existing.units += li.quantity
        existing.revenue += li.quantity * Number(li.unit_price)
        existing.cogs += li.quantity * Number(li.skus?.cost_price ?? 0)
        existing.grossProfit = existing.revenue - existing.cogs
        rollupByWarehouse.set(key, existing)
      }
      setWarehouseRollups(Array.from(rollupByWarehouse.values()).sort((a, b) => b.revenue - a.revenue))

      setLoading(false)
    })()
  }, [orgId])

  const totals = useMemo(() => {
    const revenue = orderRows.reduce((sum, r) => sum + Number(r.order.gross_amount), 0)
    const cogs = orderRows.reduce((sum, r) => sum + r.cogs, 0)
    const knownFees = orderRows.filter((r) => r.fees != null)
    const fees = knownFees.reduce((sum, r) => sum + (r.fees ?? 0), 0)
    const netProfit = knownFees.reduce((sum, r) => sum + (r.netProfit ?? 0), 0)
    return { revenue, cogs, fees, netProfit, ordersWithFees: knownFees.length, ordersTotal: orderRows.length }
  }, [orderRows])

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Profit &amp; Loss</h2>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        Three distinct numbers, never merged: <strong>Revenue</strong> (gross order value) → <strong>Gross Profit</strong> (revenue minus
        cost price) → <strong>Contribution Profit</strong> (gross profit minus Amazon fees/commission/TCS/TDS, from MTR reconciliation).
        Contribution profit only shows once an order's MTR is imported — until then it's shown as an estimated gross-profit figure, never
        silently assumed to equal full profit.
      </p>

      {loading ? (
        <Skeleton rows={3} />
      ) : orderRows.length === 0 ? (
        <EmptyState icon="📊" title="No orders yet." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <Stat label="Revenue (all orders)" value={formatINR(totals.revenue)} />
            <Stat label="COGS" value={formatINR(totals.cogs)} />
            <Stat label="Amazon fees (reconciled orders)" value={formatINR(totals.fees)} sub={`${totals.ordersWithFees} of ${totals.ordersTotal} orders`} />
            <Stat label="Contribution profit (reconciled orders)" value={formatINR(totals.netProfit)} accent />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Profit by SKU</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700/60">
                    <th className="px-4 py-2 font-medium">SKU</th>
                    <th className="px-4 py-2 font-medium">Title</th>
                    <th className="px-4 py-2 font-medium text-right">Units sold</th>
                    <th className="px-4 py-2 font-medium text-right">Revenue</th>
                    <th className="px-4 py-2 font-medium text-right">COGS</th>
                    <th className="px-4 py-2 font-medium text-right">Gross profit</th>
                    <th className="px-4 py-2 font-medium text-right">Margin %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                  {skuRollups.map((r) => (
                    <tr key={r.sku}>
                      <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{r.sku}</td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{r.title}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{r.units}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{formatINR(r.revenue)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{formatINR(r.cogs)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${r.grossMargin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatINR(r.grossMargin)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{r.revenue > 0 ? `${((r.grossMargin / r.revenue) * 100).toFixed(1)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Profit by order</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700/60">
                    <th className="px-4 py-2 font-medium">Order</th>
                    <th className="px-4 py-2 font-medium text-right">Revenue</th>
                    <th className="px-4 py-2 font-medium text-right">COGS</th>
                    <th className="px-4 py-2 font-medium text-right">Amazon fees</th>
                    <th className="px-4 py-2 font-medium text-right">Contribution profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                  {orderRows.map((r) => (
                    <tr key={r.order.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{r.order.amazon_order_id}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{formatINR(Number(r.order.gross_amount))}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{formatINR(r.cogs)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{r.fees != null ? formatINR(r.fees) : '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        {r.netProfit != null ? (
                          <span className={r.netProfit < 0 ? 'text-red-600 font-medium' : 'text-emerald-600 font-medium'}>{formatINR(r.netProfit)}</span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500" title="Fees unknown until this order's MTR is imported">
                            {formatINR(r.grossMargin)} (est.)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden mt-6">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Profit by channel</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700/60">
                    <th className="px-4 py-2 font-medium">Channel</th>
                    <th className="px-4 py-2 font-medium text-right">Orders</th>
                    <th className="px-4 py-2 font-medium text-right">Revenue</th>
                    <th className="px-4 py-2 font-medium text-right">Gross profit</th>
                    <th className="px-4 py-2 font-medium text-right">Contribution profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                  {channelRollups.map((r) => (
                    <tr key={r.name}>
                      <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{r.name}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{r.orders}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{formatINR(r.revenue)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${r.grossProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatINR(r.grossProfit)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">
                        {r.ordersWithFees > 0 ? `${formatINR(r.contributionProfit)} (${r.ordersWithFees}/${r.orders} orders)` : '— no MTR yet'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden mt-6">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Profit by warehouse</div>
            <p className="px-4 pt-3 text-xs text-slate-400 dark:text-slate-500">
              Gross profit only — Amazon fees are per-order, not splittable across a multi-warehouse order's individual lines.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700/60">
                    <th className="px-4 py-2 font-medium">Warehouse</th>
                    <th className="px-4 py-2 font-medium text-right">Units sold</th>
                    <th className="px-4 py-2 font-medium text-right">Revenue</th>
                    <th className="px-4 py-2 font-medium text-right">Gross profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                  {warehouseRollups.map((r) => (
                    <tr key={r.name}>
                      <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{r.name}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{r.units}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{formatINR(r.revenue)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${r.grossProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatINR(r.grossProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-3.5 sm:p-4 relative overflow-hidden">
      {accent && <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-emerald-600" />}
      <div className="text-xs text-slate-400 dark:text-slate-500">{label}</div>
      <div className="text-lg sm:text-xl font-semibold mt-1 text-slate-900 dark:text-slate-100">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}
