import { useEffect, useState } from 'react'
import { format, subDays, startOfDay } from 'date-fns'
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatINR } from '../lib/format'
import Skeleton from '../components/Skeleton'
import type { Tables } from '../lib/database.types'

type Sku = Tables<'skus'>
type LineItem = Tables<'order_line_items'> & { skus: Sku | null }
type Order = Tables<'orders'>

const TREND_DAYS = 14
const WINDOW_DAYS = 30

interface Metrics {
  healthScore: number
  healthBreakdown: { label: string; value: number }[]
  revenue30: number
  revenuePrior30: number
  growthPct: number | null
  ordersToday: number
  revenueToday: number
  orders30: number
  aov: number
  grossProfit30: number
  marginPct: number | null
  slaCompliancePct: number | null
  slaBreached: number
  slaDueSoon: number
  slaOnTrack: number
  slaTracked: number
  stockHealthPct: number
  outOfStockCount: number
  totalSkus: number
  inventoryValue: number
  returnRatePct: number | null
  rtoRatePct: number | null
  reconciliationHealthPct: number | null
  trend: { date: string; revenue: number }[]
  channelPerf: { channel: string; revenue: number; orders: number }[]
  topChannel: string | null
  pendingPick: number
  pendingPack: number
  pendingDispatch: number
  pendingSettlement: number
  topSku: { sku: string; title: string; revenue: number } | null
}

export default function CeoDashboard() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [m, setM] = useState<Metrics | null>(null)
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function load() {
    setLoading(true)
    const [{ data: orders }, { data: lineItems }, { data: skus }, { data: ledger }, { data: returns }, { data: channels }, { data: reconEntries }] =
      await Promise.all([
        supabase.from('orders').select('*'),
        supabase.from('order_line_items').select('*, skus(*)'),
        supabase.from('skus').select('*').eq('active', true),
        supabase.from('inventory_ledger').select('sku_id, quantity_delta'),
        supabase.from('order_returns').select('created_at, return_type'),
        supabase.from('channels').select('id, display_name'),
        supabase.from('reconciliation_entries').select('status, expected_settlement, actual_settlement'),
      ])

    const ordersData: Order[] = orders ?? []
    const items: LineItem[] = (lineItems as unknown as LineItem[]) ?? []
    const now = Date.now()
    const today = startOfDay(new Date())
    const cutoff30 = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
    const cutoffPrior60 = Date.now() - 2 * WINDOW_DAYS * 24 * 60 * 60 * 1000

    const orders30 = ordersData.filter((o) => new Date(o.order_date).getTime() >= cutoff30)
    const ordersPrior30 = ordersData.filter((o) => {
      const t = new Date(o.order_date).getTime()
      return t >= cutoffPrior60 && t < cutoff30
    })
    const revenue30 = orders30.reduce((s, o) => s + Number(o.gross_amount), 0)
    const revenuePrior30 = ordersPrior30.reduce((s, o) => s + Number(o.gross_amount), 0)
    const growthPct = revenuePrior30 > 0 ? ((revenue30 - revenuePrior30) / revenuePrior30) * 100 : null

    const ordersTodayList = ordersData.filter((o) => new Date(o.order_date) >= today)
    const revenueToday = ordersTodayList.reduce((s, o) => s + Number(o.gross_amount), 0)

    const orderIds30 = new Set(orders30.map((o) => o.id))
    const items30 = items.filter((li) => orderIds30.has(li.order_id))
    const cogs30 = items30.reduce((s, li) => s + li.quantity * Number(li.skus?.cost_price ?? 0), 0)
    const grossProfit30 = revenue30 - cogs30
    const marginPct = revenue30 > 0 ? (grossProfit30 / revenue30) * 100 : null
    const aov = orders30.length > 0 ? revenue30 / orders30.length : 0

    // SLA: among open orders that have a due date, split into breached /
    // due within 24h / on track. Always shown with real counts (including
    // zero) rather than hidden, since SLA risk is the most operationally
    // urgent number on this page.
    const TERMINAL: string[] = ['delivered', 'cancelled', 'returned', 'rto']
    const openOrders = ordersData.filter((o) => !TERMINAL.includes(o.order_status))
    const openWithSla = openOrders.filter((o) => o.sla_due_at)
    const slaBreached = openWithSla.filter((o) => new Date(o.sla_due_at!).getTime() < now).length
    const slaDueSoon = openWithSla.filter((o) => {
      const due = new Date(o.sla_due_at!).getTime()
      return due >= now && due - now < 24 * 60 * 60 * 1000
    }).length
    const slaOnTrack = openWithSla.length - slaBreached - slaDueSoon
    const slaCompliancePct = openWithSla.length > 0 ? ((openWithSla.length - slaBreached) / openWithSla.length) * 100 : null

    const pendingPick = ordersData.filter((o) => o.order_status === 'ready_to_pick').length
    const pendingPack = ordersData.filter((o) => o.order_status === 'picked').length
    const pendingDispatch = ordersData.filter((o) => o.order_status === 'ready_to_ship').length

    // Inventory health
    const stockBySku: Record<string, number> = {}
    for (const row of ledger ?? []) stockBySku[row.sku_id] = (stockBySku[row.sku_id] ?? 0) + row.quantity_delta
    const activeSkus = skus ?? []
    const outOfStockCount = activeSkus.filter((s) => (stockBySku[s.id] ?? 0) <= 0).length
    const stockHealthPct = activeSkus.length > 0 ? ((activeSkus.length - outOfStockCount) / activeSkus.length) * 100 : 100
    const inventoryValue = activeSkus.reduce((s, sku) => s + Math.max(stockBySku[sku.id] ?? 0, 0) * Number(sku.cost_price), 0)

    // Returns / RTO rate over the same 30d order volume
    const returns30 = (returns ?? []).filter((r) => new Date(r.created_at).getTime() >= cutoff30)
    const returnRatePct = orders30.length > 0 ? (returns30.filter((r) => r.return_type === 'customer_return').length / orders30.length) * 100 : null
    const rtoRatePct = orders30.length > 0 ? (returns30.filter((r) => r.return_type === 'rto').length / orders30.length) * 100 : null

    // Reconciliation health + cash outstanding
    const recon = reconEntries ?? []
    const reconciliationHealthPct = recon.length > 0 ? (recon.filter((r) => r.status === 'matched').length / recon.length) * 100 : null
    const pendingSettlement = recon.filter((r) => r.actual_settlement == null).reduce((s, r) => s + Number(r.expected_settlement), 0)

    // Top SKU by revenue in the last 30 days
    const skuRevenue: Record<string, { sku: string; title: string; revenue: number }> = {}
    for (const li of items30) {
      if (!li.skus) continue
      const key = li.sku_id
      const existing = skuRevenue[key] ?? { sku: li.skus.sku, title: li.skus.title, revenue: 0 }
      existing.revenue += li.quantity * Number(li.unit_price)
      skuRevenue[key] = existing
    }
    const topSku = Object.values(skuRevenue).sort((a, b) => b.revenue - a.revenue)[0] ?? null

    // 14-day revenue trend
    const days = Array.from({ length: TREND_DAYS }).map((_, i) => startOfDay(subDays(new Date(), TREND_DAYS - 1 - i)))
    const trend = days.map((d) => ({
      date: format(d, 'dd MMM'),
      revenue: ordersData.filter((o) => startOfDay(new Date(o.order_date)).getTime() === d.getTime()).reduce((s, o) => s + Number(o.gross_amount), 0),
    }))

    // Channel performance
    const channelRevenue: Record<string, number> = {}
    const channelOrders: Record<string, number> = {}
    for (const o of ordersData) {
      channelRevenue[o.channel_id] = (channelRevenue[o.channel_id] ?? 0) + Number(o.gross_amount)
      channelOrders[o.channel_id] = (channelOrders[o.channel_id] ?? 0) + 1
    }
    const channelPerf = (channels ?? [])
      .map((c) => ({ channel: c.display_name, revenue: channelRevenue[c.id] ?? 0, orders: channelOrders[c.id] ?? 0 }))
      .sort((a, b) => b.revenue - a.revenue)
    const topChannel = channelPerf.length > 0 && channelPerf[0].revenue > 0 ? channelPerf[0].channel : null

    // Composite health score - equal-weighted average of the four pillars
    // that have data; pillars with no data yet are excluded rather than
    // guessed at, so the score never fabricates a number from nothing.
    const pillars = [
      { label: 'SLA compliance', value: slaCompliancePct },
      { label: 'Stock availability', value: stockHealthPct },
      { label: 'Order quality (inverse return rate)', value: returnRatePct != null ? Math.max(0, 100 - returnRatePct * 5) : null },
      { label: 'Reconciliation match rate', value: reconciliationHealthPct },
    ]
    const scored = pillars.filter((p): p is { label: string; value: number } => p.value != null)
    const healthScore = scored.length > 0 ? Math.round(scored.reduce((s, p) => s + p.value, 0) / scored.length) : 0

    setM({
      healthScore,
      healthBreakdown: pillars.map((p) => ({ label: p.label, value: p.value != null ? Math.round(p.value) : 0 })),
      revenue30,
      revenuePrior30,
      growthPct,
      ordersToday: ordersTodayList.length,
      revenueToday,
      orders30: orders30.length,
      aov,
      grossProfit30,
      marginPct,
      slaCompliancePct,
      slaBreached,
      slaDueSoon,
      slaOnTrack,
      slaTracked: openWithSla.length,
      stockHealthPct,
      outOfStockCount,
      totalSkus: activeSkus.length,
      inventoryValue,
      returnRatePct,
      rtoRatePct,
      reconciliationHealthPct,
      trend,
      channelPerf,
      topChannel,
      pendingPick,
      pendingPack,
      pendingDispatch,
      pendingSettlement,
      topSku,
    })
    setLoading(false)
  }

  if (loading || !m) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-6">CEO Dashboard</h2>
        <Skeleton rows={8} />
      </div>
    )
  }

  const scoreColor = m.healthScore >= 75 ? '#34d399' : m.healthScore >= 50 ? '#fbbf24' : '#f87171'

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">CEO Dashboard</h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          {format(new Date(), 'EEEE, dd MMMM yyyy')} · Executive summary, computed live from the same data as every other page
        </p>
      </div>

      {/* Hero: health score + headline metrics */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-6 sm:p-8 mb-6 shadow-lg shadow-indigo-900/20">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '20px 20px' }} />
        <div className="relative flex flex-col lg:flex-row items-center lg:items-stretch gap-8">
          <div className="flex flex-col items-center justify-center shrink-0">
            <div
              className="relative w-36 h-36 rounded-full flex items-center justify-center"
              style={{ background: `conic-gradient(${scoreColor} ${m.healthScore * 3.6}deg, rgba(255,255,255,0.15) 0deg)` }}
            >
              <div className="absolute inset-2 rounded-full bg-indigo-700/90 backdrop-blur flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-white tabular-nums">{m.healthScore}</span>
                <span className="text-[10px] uppercase tracking-wide text-indigo-200">Health score</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 max-w-[220px]">
              {m.healthBreakdown.map((p) => (
                <span key={p.label} className="text-[10px] text-indigo-200" title={p.label}>
                  {p.label.split(' ')[0]} {p.value}
                </span>
              ))}
            </div>
          </div>

          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
            <HeroStat label="Revenue (30d)" value={formatINR(m.revenue30)} delta={m.growthPct} />
            <HeroStat label="Gross profit (30d)" value={formatINR(m.grossProfit30)} sub={m.marginPct != null ? `${m.marginPct.toFixed(1)}% margin` : undefined} />
            <HeroStat label="Orders (30d)" value={String(m.orders30)} sub={`AOV ${formatINR(m.aov)}`} />
            <HeroStat label="Today" value={formatINR(m.revenueToday)} sub={`${m.ordersToday} order${m.ordersToday === 1 ? '' : 's'}`} />
          </div>
        </div>
      </div>

      {/* SLA - the most operationally urgent number, always shown with real counts */}
      <div
        className={`rounded-xl border shadow-sm p-4 mb-6 flex flex-wrap items-center gap-6 ${
          m.slaBreached > 0
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
        }`}
      >
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">SLA breached</div>
          <div className={`text-3xl font-bold mt-0.5 tabular-nums ${m.slaBreached > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
            {m.slaBreached}
          </div>
        </div>
        <div className="h-10 w-px bg-slate-200 dark:bg-slate-700" />
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Due within 24h</div>
          <div className={`text-xl font-semibold mt-0.5 tabular-nums ${m.slaDueSoon > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'}`}>
            {m.slaDueSoon}
          </div>
        </div>
        <div className="h-10 w-px bg-slate-200 dark:bg-slate-700" />
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">On track</div>
          <div className="text-xl font-semibold mt-0.5 tabular-nums text-slate-900 dark:text-slate-100">{m.slaOnTrack}</div>
        </div>
        <div className="h-10 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Compliance</div>
          <div className="text-xl font-semibold mt-0.5 tabular-nums text-slate-900 dark:text-slate-100">
            {m.slaCompliancePct != null ? `${m.slaCompliancePct.toFixed(0)}%` : '—'}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500">{m.slaTracked} open order{m.slaTracked === 1 ? '' : 's'} tracked</div>
        </div>
      </div>

      {/* Pillar KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <PillarCard
          label="Inventory"
          value={`${m.stockHealthPct.toFixed(0)}%`}
          sub={`${m.outOfStockCount}/${m.totalSkus} SKUs out of stock`}
          tone={m.stockHealthPct >= 90 ? 'good' : m.stockHealthPct >= 70 ? 'warn' : 'bad'}
        />
        <PillarCard
          label="Customer satisfaction"
          value={m.returnRatePct != null ? `${Math.max(0, 100 - m.returnRatePct * 5).toFixed(0)}%` : '—'}
          sub={`${m.returnRatePct != null ? `${m.returnRatePct.toFixed(1)}% returned` : 'no orders yet'}${m.rtoRatePct != null ? ` · ${m.rtoRatePct.toFixed(1)}% RTO` : ''}`}
          tone={m.returnRatePct == null ? 'neutral' : m.returnRatePct <= 3 ? 'good' : m.returnRatePct <= 8 ? 'warn' : 'bad'}
        />
        <PillarCard
          label="Reconciliation"
          value={m.reconciliationHealthPct != null ? `${m.reconciliationHealthPct.toFixed(0)}%` : '—'}
          sub="settlements matched"
          tone={m.reconciliationHealthPct == null ? 'neutral' : m.reconciliationHealthPct >= 90 ? 'good' : m.reconciliationHealthPct >= 70 ? 'warn' : 'bad'}
        />
      </div>

      {/* Revenue trend + channel mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Revenue trend (14 days)</h3>
            <span className="text-xs text-slate-400 dark:text-slate-500">{formatINR(m.trend.reduce((s, t) => s + t.revenue, 0))} total</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={m.trend}>
              <defs>
                <linearGradient id="ceoRevenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide />
              <Tooltip formatter={(v) => formatINR(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#6366f1" strokeWidth={2} fill="url(#ceoRevenueFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Channel mix</h3>
            {m.topChannel && <span className="text-[10px] uppercase tracking-wide text-indigo-600 dark:text-indigo-400 font-semibold">Top: {m.topChannel}</span>}
          </div>
          {m.channelPerf.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 py-6 text-center">No channels connected yet.</p>
          ) : (
            <div className="space-y-3">
              {(() => {
                const max = Math.max(...m.channelPerf.map((c) => c.revenue), 1)
                return m.channelPerf.slice(0, 6).map((c) => (
                  <div key={c.channel}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-600 dark:text-slate-300 truncate">{c.channel}</span>
                      <span className="text-slate-400 dark:text-slate-500 shrink-0 ml-2">{formatINR(c.revenue)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700/60 overflow-hidden">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(c.revenue / max) * 100}%` }} />
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Operational backlog + cash + top mover */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 flex flex-wrap items-center gap-6 mb-6">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Backlog: pick / pack / dispatch</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
            {m.pendingPick} / {m.pendingPack} / {m.pendingDispatch}
          </div>
        </div>
        <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Cash pending settlement</div>
          <div className="text-lg font-semibold text-amber-600 dark:text-amber-400 mt-0.5">{formatINR(m.pendingSettlement)}</div>
        </div>
        <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Top mover (30d)</div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
            {m.topSku ? `${m.topSku.sku} — ${formatINR(m.topSku.revenue)}` : '—'}
          </div>
        </div>
      </div>

      {/* Inventory value strip */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 flex flex-wrap items-center gap-6">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Inventory on hand (cost value)</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{formatINR(m.inventoryValue)}</div>
        </div>
        <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Revenue growth (30d vs prior 30d)</div>
          <div className={`text-lg font-semibold mt-0.5 ${m.growthPct == null ? 'text-slate-400 dark:text-slate-500' : m.growthPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {m.growthPct != null ? `${m.growthPct >= 0 ? '+' : ''}${m.growthPct.toFixed(1)}%` : 'Not enough history yet'}
          </div>
        </div>
      </div>
    </div>
  )
}

function HeroStat({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: number | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-indigo-200">{label}</div>
      <div className="text-2xl font-bold text-white mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-indigo-200 mt-0.5">{sub}</div>}
      {delta != null && (
        <div className={`text-xs mt-0.5 font-medium ${delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% vs prior 30d
        </div>
      )}
    </div>
  )
}

const TONE_STYLES: Record<'good' | 'warn' | 'bad' | 'neutral', string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  neutral: 'text-slate-500 dark:text-slate-400',
}

function PillarCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${TONE_STYLES[tone]}`}>{value}</div>
      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</div>
    </div>
  )
}
