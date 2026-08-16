import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import { calculateInvoice } from '../lib/gstInvoice'
import { buildInvoicePdf, buildCombinedInvoicesPdf, type InvoicePrintItem } from '../lib/invoicePdf'
import { buildShippingLabelsPdf, type ShippingLabelItem } from '../lib/labelPdf'
import ConfirmDialog from '../components/ConfirmDialog'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Pagination from '../components/Pagination'
import type { Tables, Enums } from '../lib/database.types'

type Order = Tables<'orders'> & { channels: Tables<'channels'> | null }
type Channel = Tables<'channels'>
type Organization = Tables<'organizations'>
type Sku = Tables<'skus'>
type Warehouse = Tables<'warehouses'>
type LineItem = Tables<'order_line_items'> & { skus: Sku | null; warehouses: Warehouse | null }
type Shipment = Tables<'shipments'>

interface LineItemDraft {
  sku_id: string
  quantity: string
  unit_price: string
}

const BLANK_LINE_ITEM: LineItemDraft = { sku_id: '', quantity: '1', unit_price: '' }
const PAGE_SIZE = 20

const ALL_STATUSES: Enums<'order_status'>[] = [
  'new',
  'confirmed',
  'inventory_allocated',
  'partially_allocated',
  'stock_shortage',
  'ready_to_pick',
  'picked',
  'packed',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
  'rto',
]

const STATUS_LABEL: Record<Enums<'order_status'>, string> = {
  new: 'New',
  confirmed: 'Confirmed',
  inventory_allocated: 'Inventory Allocated',
  partially_allocated: 'Partially Allocated',
  stock_shortage: 'Stock Shortage',
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

const STATUS_COLOR: Record<Enums<'order_status'>, string> = {
  new: 'bg-slate-100 text-slate-600',
  confirmed: 'bg-sky-100 text-sky-700',
  inventory_allocated: 'bg-indigo-100 text-indigo-700',
  partially_allocated: 'bg-amber-100 text-amber-700',
  stock_shortage: 'bg-red-100 text-red-700',
  ready_to_pick: 'bg-purple-100 text-purple-700',
  picked: 'bg-purple-100 text-purple-700',
  packed: 'bg-blue-100 text-blue-700',
  ready_to_ship: 'bg-blue-100 text-blue-700',
  shipped: 'bg-cyan-100 text-cyan-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
  returned: 'bg-red-100 text-red-700',
  rto: 'bg-red-100 text-red-700',
}

const PRIORITY_COLOR: Record<Enums<'order_priority'>, string> = {
  normal: 'bg-slate-100 text-slate-600',
  high: 'bg-amber-100 text-amber-700',
  urgent: 'bg-red-100 text-red-700',
}

const TERMINAL_STATUSES: Enums<'order_status'>[] = ['delivered', 'cancelled', 'returned', 'rto']
const OPEN_STATUSES = ALL_STATUSES.filter((s) => !TERMINAL_STATUSES.includes(s))

function slaState(o: Order): 'overdue' | 'due_soon' | 'ok' | null {
  if (!o.sla_due_at || !OPEN_STATUSES.includes(o.order_status)) return null
  const due = new Date(o.sla_due_at).getTime()
  const now = Date.now()
  if (due < now) return 'overdue'
  if (due - now < 24 * 60 * 60 * 1000) return 'due_soon'
  return 'ok'
}

export default function Orders() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [totalOrders, setTotalOrders] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Enums<'order_status'> | ''>('')
  const [channelFilter, setChannelFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [stats, setStats] = useState({ gross: 0, open: 0, overdue: 0 })
  const [updatingPriorityId, setUpdatingPriorityId] = useState<string | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [org, setOrg] = useState<Organization | null>(null)
  const [invoicedOrderIds, setInvoicedOrderIds] = useState<Set<string>>(new Set())
  const [lineItemsByOrder, setLineItemsByOrder] = useState<Record<string, LineItem[]>>({})
  const [shipmentByOrder, setShipmentByOrder] = useState<Record<string, Shipment>>({})
  const [loading, setLoading] = useState(true)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [confirmInvoiceFor, setConfirmInvoiceFor] = useState<Order | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState<string | null>(null)
  const [confirmBulkShip, setConfirmBulkShip] = useState(false)
  const [bulkInvoiceProgress, setBulkInvoiceProgress] = useState({ done: 0, total: 0 })
  const [printingInvoices, setPrintingInvoices] = useState(false)
  const [printingLabels, setPrintingLabels] = useState(false)
  const [skus, setSkus] = useState<Sku[]>([])
  const [warehousesList, setWarehousesList] = useState<Warehouse[]>([])
  const [defaultWarehouseId, setDefaultWarehouseId] = useState<string | null>(null)
  const [showNewOrder, setShowNewOrder] = useState(false)
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [orderForm, setOrderForm] = useState({
    amazon_order_id: '',
    order_date: format(new Date(), 'yyyy-MM-dd'),
    customer_name: '',
    payment_type: 'Prepaid',
    buyer_state: '',
    ship_state: '',
    ship_address: '',
    channel_id: '',
    priority: 'normal' as Enums<'order_priority'>,
    sla_due_at: '',
  })
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([{ ...BLANK_LINE_ITEM }])
  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function loadOrders() {
    setLoading(true)
    let query = supabase.from('orders').select('*, channels(*)', { count: 'exact' }).order('order_date', { ascending: false })
    if (search.trim()) query = query.ilike('amazon_order_id', `%${search.trim()}%`)
    if (statusFilter) query = query.eq('order_status', statusFilter)
    if (channelFilter) query = query.eq('channel_id', channelFilter)
    if (paymentFilter) query = query.eq('payment_type', paymentFilter)
    if (dateFrom) query = query.gte('order_date', new Date(dateFrom).toISOString())
    if (dateTo) query = query.lte('order_date', new Date(dateTo + 'T23:59:59').toISOString())
    if (warehouseFilter) {
      const { data: matchingLines } = await supabase.from('order_line_items').select('order_id').eq('warehouse_id', warehouseFilter)
      const ids = Array.from(new Set((matchingLines ?? []).map((l) => l.order_id)))
      query = query.in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
    }
    const { data, count } = await query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    const pageOrders = (data as unknown as Order[]) ?? []
    setOrders(pageOrders)
    setTotalOrders(count ?? 0)

    const orderIds = pageOrders.map((o) => o.id)
    if (orderIds.length > 0) {
      const [{ data: li }, { data: ships }] = await Promise.all([
        supabase.from('order_line_items').select('*, skus(*), warehouses(*)').in('order_id', orderIds),
        supabase.from('shipments').select('*').in('order_id', orderIds),
      ])
      const byOrder: Record<string, LineItem[]> = {}
      for (const row of (li as unknown as LineItem[]) ?? []) {
        byOrder[row.order_id] = [...(byOrder[row.order_id] ?? []), row]
      }
      setLineItemsByOrder(byOrder)
      const shipByOrder: Record<string, Shipment> = {}
      for (const s of ships ?? []) shipByOrder[s.order_id] = s
      setShipmentByOrder(shipByOrder)
    } else {
      setLineItemsByOrder({})
      setShipmentByOrder({})
    }
    setLoading(false)
  }

  async function loadStats() {
    const { data } = await supabase.from('orders').select('gross_amount, order_status, sla_due_at')
    const rows = data ?? []
    const now = Date.now()
    setStats({
      gross: rows.reduce((sum, r) => sum + Number(r.gross_amount), 0),
      open: rows.filter((r) => OPEN_STATUSES.includes(r.order_status)).length,
      overdue: rows.filter((r) => r.sla_due_at && OPEN_STATUSES.includes(r.order_status) && new Date(r.sla_due_at).getTime() < now).length,
    })
  }

  async function loadSupportingData() {
    if (!orgId) return
    const [{ data: c }, { data: orgRow }, { data: inv }, { data: s }, { data: w }] = await Promise.all([
      supabase.from('channels').select('*'),
      supabase.from('organizations').select('*').eq('id', orgId).single(),
      supabase.from('gst_invoices').select('order_id'),
      supabase.from('skus').select('*').eq('active', true).order('sku'),
      supabase.from('warehouses').select('*').order('allocation_priority'),
    ])
    setChannels(c ?? [])
    setOrg(orgRow ?? null)
    setInvoicedOrderIds(new Set((inv ?? []).map((i) => i.order_id)))
    setSkus(s ?? [])
    setWarehousesList(w ?? [])
    setDefaultWarehouseId((w ?? []).find((x) => x.is_default)?.id ?? null)
    if (c && c.length > 0 && !orderForm.channel_id) setOrderForm((f) => ({ ...f, channel_id: c[0].id }))
  }

  useEffect(() => {
    if (!orgId) return
    loadSupportingData()
    loadStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    loadOrders()
    setSelectedIds(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, page, search, statusFilter, channelFilter, warehouseFilter, paymentFilter, dateFrom, dateTo])

  useEffect(() => {
    setPage(0)
  }, [search, statusFilter, channelFilter, warehouseFilter, paymentFilter, dateFrom, dateTo])

  async function createTestChannel() {
    if (!orgId) return
    setCreatingChannel(true)
    const { error } = await supabase.from('channels').insert({
      organization_id: orgId,
      marketplace_id: 'A21TJRUUN4KGV',
      seller_id: 'MANUAL-TEST',
      display_name: 'Manual Test Channel',
      status: 'manual',
      connected_by: profile!.id,
      connected_at: new Date().toISOString(),
    })
    setCreatingChannel(false)
    if (error) {
      reportError(showError, 'Create test channel', error, orgId, profile?.id)
      return
    }
    showSuccess('Test channel created — manual orders can now be entered against it.')
    loadSupportingData()
  }

  function updateLineItem(index: number, patch: Partial<LineItemDraft>) {
    setLineItems((items) => items.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }

  async function pickWarehouseForDeduction(skuId: string, qty: number): Promise<string> {
    for (const w of warehousesList) {
      const { data: rows } = await supabase.from('inventory_ledger').select('quantity_delta').eq('sku_id', skuId).eq('warehouse_id', w.id)
      const stock = (rows ?? []).reduce((sum, r) => sum + r.quantity_delta, 0)
      if (stock >= qty) return w.id
    }
    return defaultWarehouseId!
  }

  async function submitOrder() {
    if (!orgId) return
    if (!orderForm.amazon_order_id.trim() || !orderForm.channel_id) {
      showError('Order ID and channel are required.')
      return
    }
    const validLines = lineItems.filter((li) => li.sku_id && Number(li.quantity) > 0 && li.unit_price !== '')
    if (validLines.length === 0) {
      showError('Add at least one line item with a SKU, quantity, and price.')
      return
    }
    if (!defaultWarehouseId) {
      showError('No default warehouse set — add one under Warehouses first.')
      return
    }

    setSavingOrder(true)
    try {
      const grossAmount = validLines.reduce((sum, li) => sum + Number(li.quantity) * Number(li.unit_price), 0)

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          organization_id: orgId,
          channel_id: orderForm.channel_id,
          amazon_order_id: orderForm.amazon_order_id.trim(),
          order_date: new Date(orderForm.order_date).toISOString(),
          customer_name: orderForm.customer_name || null,
          payment_type: orderForm.payment_type || null,
          buyer_state: orderForm.buyer_state || null,
          ship_state: orderForm.ship_state || orderForm.buyer_state || null,
          ship_address: orderForm.ship_address || null,
          priority: orderForm.priority,
          sla_due_at: orderForm.sla_due_at ? new Date(orderForm.sla_due_at).toISOString() : null,
          gross_amount: grossAmount,
        })
        .select()
        .single()
      if (orderError || !order) throw orderError ?? new Error('Could not create order')

      const { error: liError } = await supabase.from('order_line_items').insert(
        validLines.map((li) => ({
          organization_id: orgId,
          order_id: order.id,
          sku_id: li.sku_id,
          quantity: Number(li.quantity),
          unit_price: Number(li.unit_price),
        }))
      )
      if (liError) throw liError

      // Bundle SKUs don't hold their own stock - selling one deducts each
      // component's stock instead (one level deep only).
      const bundleSkuIds = validLines.map((li) => li.sku_id).filter((id) => skus.find((s) => s.id === id)?.is_bundle)
      const { data: bundleComponents } = bundleSkuIds.length > 0
        ? await supabase.from('bundle_components').select('*').in('bundle_sku_id', bundleSkuIds)
        : { data: [] }

      const deductions: { sku_id: string; quantity: number }[] = []
      for (const li of validLines) {
        const components = (bundleComponents ?? []).filter((c) => c.bundle_sku_id === li.sku_id)
        if (components.length > 0) {
          for (const c of components) deductions.push({ sku_id: c.component_sku_id, quantity: c.quantity * Number(li.quantity) })
        } else {
          deductions.push({ sku_id: li.sku_id, quantity: Number(li.quantity) })
        }
      }

      const ledgerRows = await Promise.all(
        deductions.map(async (d) => ({
          organization_id: orgId,
          sku_id: d.sku_id,
          warehouse_id: await pickWarehouseForDeduction(d.sku_id, d.quantity),
          movement_type: 'order_deduction' as const,
          quantity_delta: -d.quantity,
          order_id: order.id,
          reference_type: 'order',
          reference_id: order.id,
          note: `Manual order ${orderForm.amazon_order_id.trim()}`,
        }))
      )
      const { error: ledgerError } = await supabase.from('inventory_ledger').insert(ledgerRows)
      if (ledgerError) throw ledgerError

      showSuccess(`Order ${orderForm.amazon_order_id} created.`)
      setOrderForm((f) => ({ ...f, amazon_order_id: '', customer_name: '', buyer_state: '', ship_state: '', ship_address: '', priority: 'normal', sla_due_at: '' }))
      setLineItems([{ ...BLANK_LINE_ITEM }])
      setShowNewOrder(false)
      loadOrders()
      loadStats()
    } catch (err) {
      reportError(showError, 'Create manual order', err as { message: string }, orgId, profile?.id)
    } finally {
      setSavingOrder(false)
    }
  }

  // Throws on failure - shared by the single-order button and the bulk
  // action, which need different error handling (one toast vs. a summary).
  async function generateInvoiceCore(order: Order) {
    if (!org || !orgId) throw new Error('Organization not loaded')

    const { data: lineItems, error: liError } = await supabase
      .from('order_line_items')
      .select('*, skus(*)')
      .eq('order_id', order.id)
    if (liError) throw liError
    if (!lineItems || lineItems.length === 0) throw new Error('No line items on this order — cannot generate an invoice.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calc = calculateInvoice(org.state, order.buyer_state, lineItems as any)

    const { data: invoiceNumber, error: numError } = await supabase.rpc('next_invoice_number')
    if (numError || !invoiceNumber) throw numError ?? new Error('Could not allocate invoice number')

    const pdfBlob = buildInvoicePdf(org, order, invoiceNumber, calc)
    const path = `${orgId}/${invoiceNumber}.pdf`
    const { error: uploadError } = await supabase.storage.from('invoices').upload(path, pdfBlob, { contentType: 'application/pdf' })
    if (uploadError) throw uploadError

    const { error: insertError } = await supabase.from('gst_invoices').insert({
      organization_id: orgId,
      order_id: order.id,
      invoice_number: invoiceNumber,
      invoice_type: calc.invoiceType,
      taxable_value: calc.taxableValue,
      cgst_amount: calc.cgstAmount,
      sgst_amount: calc.sgstAmount,
      igst_amount: calc.igstAmount,
      total_amount: calc.totalAmount,
      pdf_url: path,
    })
    if (insertError) throw insertError

    setInvoicedOrderIds((s) => new Set(s).add(order.id))
    return invoiceNumber
  }

  async function generateInvoice(order: Order) {
    setGeneratingId(order.id)
    try {
      const invoiceNumber = await generateInvoiceCore(order)
      showSuccess(`Invoice ${invoiceNumber} generated.`)
    } catch (err) {
      reportError(showError, 'Generate invoice', err as { message: string }, orgId, profile?.id)
    } finally {
      setGeneratingId(null)
      setConfirmInvoiceFor(null)
    }
  }

  async function updatePriority(order: Order, priority: Enums<'order_priority'>) {
    setUpdatingPriorityId(order.id)
    const { error } = await supabase.from('orders').update({ priority }).eq('id', order.id)
    setUpdatingPriorityId(null)
    if (error) {
      reportError(showError, 'Update priority', error, orgId, profile?.id)
      return
    }
    loadOrders()
  }

  function toggleSelected(id: string) {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds((s) => (s.size === orders.length ? new Set() : new Set(orders.map((o) => o.id))))
  }

  async function bulkMarkShipped() {
    if (!orgId || selectedIds.size === 0) return
    setBulkBusy('ship')
    const { error } = await supabase.from('orders').update({ order_status: 'shipped' }).in('id', Array.from(selectedIds))
    setBulkBusy(null)
    setConfirmBulkShip(false)
    if (error) {
      reportError(showError, 'Bulk mark shipped', error, orgId, profile?.id)
      return
    }
    showSuccess(`${selectedIds.size} order(s) marked shipped.`)
    setSelectedIds(new Set())
    loadOrders()
    loadStats()
  }

  async function bulkGenerateInvoices() {
    const targets = orders.filter((o) => selectedIds.has(o.id) && !invoicedOrderIds.has(o.id))
    if (targets.length === 0) {
      showError('All selected orders already have invoices.')
      return
    }
    setBulkBusy('invoice')
    setBulkInvoiceProgress({ done: 0, total: targets.length })
    let failed = 0
    for (const order of targets) {
      try {
        await generateInvoiceCore(order)
      } catch (err) {
        failed++
        await supabase.from('sync_logs').insert({
          organization_id: orgId!,
          operation: 'Bulk generate invoice',
          status: 'failed',
          fault: 'order_sathi',
          message: `Order ${order.amazon_order_id}: ${(err as { message?: string })?.message ?? String(err)}`,
        })
      }
      setBulkInvoiceProgress((p) => ({ ...p, done: p.done + 1 }))
    }
    setBulkBusy(null)
    setSelectedIds(new Set())
    showSuccess(`Generated ${targets.length - failed} of ${targets.length} invoice(s).${failed > 0 ? ` ${failed} failed — check Sync Logs.` : ''}`)
  }

  async function bulkPrintInvoices() {
    if (!org || !orgId) return
    const targets = orders.filter((o) => selectedIds.has(o.id) && invoicedOrderIds.has(o.id))
    if (targets.length === 0) {
      showError('None of the selected orders have an invoice yet — generate one first.')
      return
    }
    setPrintingInvoices(true)
    try {
      const items: InvoicePrintItem[] = []
      for (const order of targets) {
        const [{ data: invoice }, { data: lineItemsData }] = await Promise.all([
          supabase.from('gst_invoices').select('invoice_number').eq('order_id', order.id).single(),
          supabase.from('order_line_items').select('*, skus(*)').eq('order_id', order.id),
        ])
        if (!invoice || !lineItemsData || lineItemsData.length === 0) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const calc = calculateInvoice(org.state, order.buyer_state, lineItemsData as any)
        items.push({ order, invoiceNumber: invoice.invoice_number, calc })
      }
      if (items.length === 0) {
        showError('Could not load invoice data for the selected orders.')
        return
      }
      const blob = buildCombinedInvoicesPdf(org, items)
      window.open(URL.createObjectURL(blob), '_blank')
    } finally {
      setPrintingInvoices(false)
    }
  }

  async function bulkPrintLabels() {
    if (!org || !orgId) return
    const targets = orders.filter((o) => selectedIds.has(o.id))
    if (targets.length === 0) return
    setPrintingLabels(true)
    try {
      const items: ShippingLabelItem[] = []
      for (const order of targets) {
        const { data: lineItemsData } = await supabase.from('order_line_items').select('*, skus(*)').eq('order_id', order.id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items.push({ order, lineItems: (lineItemsData as any) ?? [] })
      }
      const blob = buildShippingLabelsPdf(org, items)
      window.open(URL.createObjectURL(blob), '_blank')
    } finally {
      setPrintingLabels(false)
    }
  }

  // ── Inventory allocation engine ──────────────────────────────────────────
  // Single-warehouse-per-line allocation: walk warehouses by priority, pick
  // the first with enough available stock (physical - already allocated to
  // OTHER open orders). No cross-warehouse splitting in Phase 1.
  async function physicalStock(skuId: string, warehouseId: string): Promise<number> {
    const { data } = await supabase.from('inventory_ledger').select('quantity_delta').eq('sku_id', skuId).eq('warehouse_id', warehouseId)
    return (data ?? []).reduce((sum, r) => sum + r.quantity_delta, 0)
  }

  async function alreadyAllocated(skuId: string, warehouseId: string, excludeOrderId: string): Promise<number> {
    const { data } = await supabase
      .from('order_line_items')
      .select('allocated_qty, order_id, orders!inner(order_status)')
      .eq('sku_id', skuId)
      .eq('warehouse_id', warehouseId)
      .neq('order_id', excludeOrderId)
    return (data ?? [])
      .filter((r) => !TERMINAL_STATUSES.includes((r as unknown as { orders: { order_status: Enums<'order_status'> } }).orders.order_status))
      .reduce((sum, r) => sum + r.allocated_qty, 0)
  }

  async function allocateOrder(order: Order): Promise<{ status: Enums<'order_status'>; message: string }> {
    const { data: lines } = await supabase.from('order_line_items').select('*').eq('order_id', order.id)
    if (!lines || lines.length === 0) return { status: order.order_status, message: 'No line items.' }

    let fullyAllocatedCount = 0
    for (const line of lines) {
      let bestWarehouse: string | null = null
      let bestAvailable = -1
      let fullMatch = false
      for (const w of warehousesList) {
        const physical = await physicalStock(line.sku_id, w.id)
        const reserved = await alreadyAllocated(line.sku_id, w.id, order.id)
        const available = physical - reserved
        if (available >= line.quantity) {
          bestWarehouse = w.id
          bestAvailable = line.quantity
          fullMatch = true
          break
        }
        if (available > bestAvailable) {
          bestWarehouse = w.id
          bestAvailable = Math.max(available, 0)
        }
      }
      const allocateQty = Math.max(bestAvailable, 0)
      await supabase.from('order_line_items').update({ allocated_qty: allocateQty, warehouse_id: bestWarehouse }).eq('id', line.id)
      if (fullMatch) fullyAllocatedCount++
    }

    const anyAllocated = lines.some((l) => l.quantity > 0) // placeholder, recomputed below
    void anyAllocated
    const { data: updatedLines } = await supabase.from('order_line_items').select('*').eq('order_id', order.id)
    const allFull = (updatedLines ?? []).every((l) => l.allocated_qty >= l.quantity)
    const anyPartial = (updatedLines ?? []).some((l) => l.allocated_qty > 0)

    const newStatus: Enums<'order_status'> = allFull ? 'inventory_allocated' : anyPartial ? 'partially_allocated' : 'stock_shortage'
    await supabase.from('orders').update({ order_status: newStatus }).eq('id', order.id)

    const label = allFull ? 'fully allocated' : anyPartial ? 'partially allocated' : 'stock shortage'
    return { status: newStatus, message: `${order.amazon_order_id}: ${label}` }
  }

  async function bulkAllocate() {
    const targets = orders.filter((o) => selectedIds.has(o.id) && (o.order_status === 'new' || o.order_status === 'confirmed' || o.order_status === 'partially_allocated' || o.order_status === 'stock_shortage'))
    if (targets.length === 0) {
      showError('None of the selected orders are eligible for allocation (must be New, Confirmed, Partially Allocated, or Stock Shortage).')
      return
    }
    setBulkBusy('allocate')
    let full = 0, partial = 0, shortage = 0
    for (const order of targets) {
      const result = await allocateOrder(order)
      if (result.status === 'inventory_allocated') full++
      else if (result.status === 'partially_allocated') partial++
      else shortage++
    }
    setBulkBusy(null)
    setSelectedIds(new Set())
    showSuccess(`Allocated ${targets.length} order(s): ${full} fully allocated, ${partial} partial, ${shortage} shortage.`)
    loadOrders()
  }

  async function bulkMarkReadyToPick() {
    const targets = orders.filter((o) => selectedIds.has(o.id) && o.order_status === 'inventory_allocated')
    if (targets.length === 0) {
      showError('None of the selected orders are fully Inventory Allocated yet.')
      return
    }
    setBulkBusy('rtp')
    const { error } = await supabase.from('orders').update({ order_status: 'ready_to_pick' }).in('id', targets.map((o) => o.id))
    setBulkBusy(null)
    if (error) {
      reportError(showError, 'Mark ready to pick', error, orgId, profile?.id)
      return
    }
    showSuccess(`${targets.length} order(s) marked Ready to Pick.`)
    setSelectedIds(new Set())
    loadOrders()
  }

  async function bulkGeneratePicklist() {
    const targets = orders.filter((o) => selectedIds.has(o.id) && o.order_status === 'ready_to_pick')
    if (targets.length === 0) {
      showError('None of the selected orders are Ready to Pick.')
      return
    }
    setBulkBusy('picklist')
    try {
      const { data: lines } = await supabase.from('order_line_items').select('*').in('order_id', targets.map((o) => o.id))
      const bySku = new Map<string, { qty: number; orderIds: Set<string> }>()
      for (const l of lines ?? []) {
        const existing = bySku.get(l.sku_id) ?? { qty: 0, orderIds: new Set<string>() }
        existing.qty += l.allocated_qty
        existing.orderIds.add(l.order_id)
        bySku.set(l.sku_id, existing)
      }
      if (bySku.size === 0) {
        showError('Selected orders have no allocated quantity to pick.')
        return
      }
      const { data: picklist, error: plError } = await supabase
        .from('picklists')
        .insert({ organization_id: orgId!, order_count: targets.length, created_by: profile!.id })
        .select()
        .single()
      if (plError || !picklist) throw plError ?? new Error('Could not create picklist')

      const { error: itemsError } = await supabase.from('picklist_items').insert(
        Array.from(bySku.entries()).map(([sku_id, v]) => ({
          organization_id: orgId!,
          picklist_id: picklist.id,
          sku_id,
          total_quantity: v.qty,
          order_ids: Array.from(v.orderIds),
        }))
      )
      if (itemsError) throw itemsError

      showSuccess(`Picklist generated for ${targets.length} order(s), ${bySku.size} SKU(s). Work it from the Picklists page.`)
      setSelectedIds(new Set())
    } catch (err) {
      reportError(showError, 'Generate picklist', err as { message: string }, orgId, profile?.id)
    } finally {
      setBulkBusy(null)
    }
  }

  // Quick bulk override for picking without per-SKU location granularity -
  // use the Picklists page instead when you need that.
  async function bulkMarkPicked() {
    const targets = orders.filter((o) => selectedIds.has(o.id) && o.order_status === 'ready_to_pick')
    if (targets.length === 0) {
      showError('None of the selected orders are Ready to Pick.')
      return
    }
    setBulkBusy('picked')
    for (const order of targets) {
      await supabase.from('order_line_items').update({ picked_qty: 0 }).eq('order_id', order.id) // reset, then set below per line
      const { data: lines } = await supabase.from('order_line_items').select('*').eq('order_id', order.id)
      for (const l of lines ?? []) {
        await supabase.from('order_line_items').update({ picked_qty: l.allocated_qty }).eq('id', l.id)
      }
      await supabase.from('orders').update({ order_status: 'picked' }).eq('id', order.id)
    }
    setBulkBusy(null)
    setSelectedIds(new Set())
    showSuccess(`${targets.length} order(s) marked Picked.`)
    loadOrders()
  }

  async function bulkMarkPacked() {
    const targets = orders.filter((o) => selectedIds.has(o.id) && o.order_status === 'picked')
    if (targets.length === 0) {
      showError('None of the selected orders are Picked.')
      return
    }
    // Cannot pack unless every line's picked_qty covers its allocated_qty.
    const { data: allLines } = await supabase.from('order_line_items').select('*').in('order_id', targets.map((o) => o.id))
    const shortfallOrderIds = new Set((allLines ?? []).filter((l) => l.picked_qty < l.allocated_qty).map((l) => l.order_id))
    const eligible = targets.filter((o) => !shortfallOrderIds.has(o.id))
    if (eligible.length === 0) {
      showError('Selected orders have unpicked quantity remaining — finish picking first.')
      return
    }
    setBulkBusy('packed')
    for (const order of eligible) {
      await supabase.from('packages').upsert({ organization_id: orgId!, order_id: order.id, package_count: 1, packed_by: profile!.id }, { onConflict: 'order_id' })
      const { data: lines } = await supabase.from('order_line_items').select('*').eq('order_id', order.id)
      for (const l of lines ?? []) {
        await supabase.from('order_line_items').update({ packed_qty: l.picked_qty }).eq('id', l.id)
      }
      await supabase.from('orders').update({ order_status: 'packed' }).eq('id', order.id)
    }
    setBulkBusy(null)
    setSelectedIds(new Set())
    showSuccess(`${eligible.length} of ${targets.length} order(s) marked Packed.${targets.length - eligible.length > 0 ? ` ${targets.length - eligible.length} skipped (not fully picked).` : ''}`)
    loadOrders()
  }

  async function bulkMarkReadyToShip() {
    const targets = orders.filter((o) => selectedIds.has(o.id) && o.order_status === 'packed')
    if (targets.length === 0) {
      showError('None of the selected orders are Packed.')
      return
    }
    setBulkBusy('rts')
    const { error } = await supabase.from('orders').update({ order_status: 'ready_to_ship' }).in('id', targets.map((o) => o.id))
    setBulkBusy(null)
    if (error) {
      reportError(showError, 'Mark ready to ship', error, orgId, profile?.id)
      return
    }
    showSuccess(`${targets.length} order(s) marked Ready to Ship.`)
    setSelectedIds(new Set())
    loadOrders()
  }

  const connectedChannels = channels.filter((c) => c.status === 'connected')

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Orders</h2>
          <p className="text-xs text-slate-400 mt-0.5">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/integrations" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700">
            🔌 Connect Amazon
          </Link>
          {canEdit && channels.length > 0 && (
            <button onClick={() => setShowNewOrder((v) => !v)} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
              {showNewOrder ? 'Cancel' : '+ New order'}
            </button>
          )}
        </div>
      </div>

      {channels.length === 0 && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800 flex items-center justify-between gap-3 flex-wrap">
          <span>
            No Amazon channel connected yet. Orders won't sync until SP-API credentials are added —{' '}
            <Link to="/integrations" className="underline font-medium">connect one here</Link>.
          </span>
          {profile?.role === 'admin' && (
            <button
              onClick={createTestChannel}
              disabled={creatingChannel}
              className="text-xs font-medium rounded-lg border border-amber-300 bg-white px-3 py-1.5 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap"
            >
              {creatingChannel ? 'Creating…' : 'Create test channel for a dry run'}
            </button>
          )}
        </div>
      )}

      {showNewOrder && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
          <div className="text-xs font-semibold uppercase text-slate-500 mb-3">New manual order</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
            <Field label="Order ID" value={orderForm.amazon_order_id} onChange={(v) => setOrderForm((f) => ({ ...f, amazon_order_id: v }))} placeholder="TEST-001" />
            <label className="block">
              <span className="text-xs text-slate-500">Order date</span>
              <input
                type="date"
                value={orderForm.order_date}
                onChange={(e) => setOrderForm((f) => ({ ...f, order_date: e.target.value }))}
                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
              />
            </label>
            <Field label="Customer name" value={orderForm.customer_name} onChange={(v) => setOrderForm((f) => ({ ...f, customer_name: v }))} placeholder="Optional" />
            <label className="block">
              <span className="text-xs text-slate-500">Payment type</span>
              <select
                value={orderForm.payment_type}
                onChange={(e) => setOrderForm((f) => ({ ...f, payment_type: e.target.value }))}
                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
              >
                <option value="Prepaid">Prepaid</option>
                <option value="COD">COD</option>
              </select>
            </label>
            <Field label="Buyer state" value={orderForm.buyer_state} onChange={(v) => setOrderForm((f) => ({ ...f, buyer_state: v }))} placeholder="e.g. Rajasthan" />
            {channels.length > 1 ? (
              <label className="block">
                <span className="text-xs text-slate-500">Channel</span>
                <select
                  value={orderForm.channel_id}
                  onChange={(e) => setOrderForm((f) => ({ ...f, channel_id: e.target.value }))}
                  className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <Field label="Ship state" value={orderForm.ship_state} onChange={(v) => setOrderForm((f) => ({ ...f, ship_state: v }))} placeholder="defaults to buyer state" />
            )}
            <label className="block sm:col-span-4">
              <span className="text-xs text-slate-500">Shipping address</span>
              <textarea
                value={orderForm.ship_address}
                onChange={(e) => setOrderForm((f) => ({ ...f, ship_address: e.target.value }))}
                placeholder="Full address as it should appear on the invoice"
                rows={2}
                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Priority</span>
              <select
                value={orderForm.priority}
                onChange={(e) => setOrderForm((f) => ({ ...f, priority: e.target.value as Enums<'order_priority'> }))}
                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">SLA due (optional)</span>
              <input
                type="datetime-local"
                value={orderForm.sla_due_at}
                onChange={(e) => setOrderForm((f) => ({ ...f, sla_due_at: e.target.value }))}
                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
              />
            </label>
          </div>

          <div className="text-xs text-slate-500 mb-2">Line items</div>
          {skus.length === 0 ? (
            <p className="text-sm text-slate-400 mb-3">
              No SKUs yet — <Link to="/inventory" className="underline font-medium">add one under Inventory</Link> first.
            </p>
          ) : (
            <div className="space-y-2 mb-3">
              {lineItems.map((li, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={li.sku_id}
                    onChange={(e) => updateLineItem(i, { sku_id: e.target.value })}
                    className="flex-1 text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                  >
                    <option value="">Select SKU…</option>
                    {skus.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.sku} — {s.title}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={li.quantity}
                    onChange={(e) => updateLineItem(i, { quantity: e.target.value })}
                    placeholder="Qty"
                    className="w-20 text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                  <input
                    type="number"
                    value={li.unit_price}
                    onChange={(e) => updateLineItem(i, { unit_price: e.target.value })}
                    placeholder="Unit price"
                    className="w-28 text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                  <button
                    onClick={() => setLineItems((items) => items.filter((_, idx) => idx !== i))}
                    disabled={lineItems.length === 1}
                    className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button onClick={() => setLineItems((items) => [...items, { ...BLANK_LINE_ITEM }])} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                + Add line item
              </button>
            </div>
          )}

          <button
            onClick={submitOrder}
            disabled={savingOrder || skus.length === 0}
            className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
          >
            {savingOrder ? 'Creating…' : 'Create order'}
          </button>
        </div>
      )}

      {org && !org.state && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
          Your organization's state isn't set — GST invoices can't tell CGST/SGST from IGST without it. Set it under{' '}
          <Link to="/team" className="underline font-medium">Team → Organization</Link>.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Stat label="Gross sales (all orders)" value={formatINR(stats.gross)} accent="indigo" />
        <Stat label="Open orders" value={String(stats.open)} accent="amber" />
        <Stat label="SLA overdue" value={String(stats.overdue)} accent={stats.overdue > 0 ? 'red' : undefined} />
        <Stat label="Channels connected" value={String(connectedChannels.length)} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase text-slate-500">Orders</span>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order ID…"
              className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 w-40"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Enums<'order_status'> | '')} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5">
              <option value="">All statuses</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5">
              <option value="">All channels</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            </select>
            <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5">
              <option value="">All warehouses</option>
              {warehousesList.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5">
              <option value="">All payment types</option>
              <option value="Prepaid">Prepaid</option>
              <option value="COD">COD</option>
            </select>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" title="From date" />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" title="To date" />
          </div>
        </div>
        {canEdit && selectedIds.size > 0 && (
          <div className="px-4 py-2.5 border-b border-slate-100 bg-indigo-50 flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-indigo-700">{selectedIds.size} selected</span>
            <BulkBtn onClick={bulkAllocate} busy={bulkBusy === 'allocate'} label="Allocate inventory" />
            <BulkBtn onClick={bulkMarkReadyToPick} busy={bulkBusy === 'rtp'} label="Mark ready to pick" />
            <BulkBtn onClick={bulkGeneratePicklist} busy={bulkBusy === 'picklist'} label="Generate picklist" />
            <BulkBtn onClick={bulkMarkPicked} busy={bulkBusy === 'picked'} label="Mark picked" />
            <BulkBtn onClick={bulkMarkPacked} busy={bulkBusy === 'packed'} label="Mark packed" />
            <BulkBtn onClick={bulkMarkReadyToShip} busy={bulkBusy === 'rts'} label="Mark ready to ship" />
            <BulkBtn onClick={() => setConfirmBulkShip(true)} busy={bulkBusy === 'ship'} label="Mark shipped" />
            <BulkBtn onClick={bulkGenerateInvoices} busy={bulkBusy === 'invoice'} label={bulkBusy === 'invoice' ? `Generating ${bulkInvoiceProgress.done}/${bulkInvoiceProgress.total}…` : 'Generate invoices'} />
            <BulkBtn onClick={bulkPrintInvoices} busy={printingInvoices} label="🖨 Print invoices" />
            <BulkBtn onClick={bulkPrintLabels} busy={printingLabels} label="🖨 Print shipping labels" />
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600">
              Clear
            </button>
          </div>
        )}
        {loading ? (
          <Skeleton />
        ) : orders.length === 0 ? (
          <EmptyState icon="📦" title={search || statusFilter ? 'No orders match this filter.' : 'No orders yet.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  {canEdit && (
                    <th className="px-4 py-2 font-medium w-8">
                      <input type="checkbox" checked={selectedIds.size === orders.length && orders.length > 0} onChange={toggleSelectAll} />
                    </th>
                  )}
                  <th className="px-4 py-2 font-medium">Order ID</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Channel</th>
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium">SKU / Product</th>
                  <th className="px-4 py-2 font-medium text-right">Qty</th>
                  <th className="px-4 py-2 font-medium text-right">Value</th>
                  <th className="px-4 py-2 font-medium">Payment</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Warehouse</th>
                  <th className="px-4 py-2 font-medium">Priority</th>
                  <th className="px-4 py-2 font-medium">SLA</th>
                  <th className="px-4 py-2 font-medium">Courier / AWB</th>
                  <th className="px-4 py-2 font-medium text-right">GST invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {orders.map((o) => {
                  const invoiced = invoicedOrderIds.has(o.id)
                  const lines = lineItemsByOrder[o.id] ?? []
                  const skuSummary = lines.map((l) => l.skus?.sku).filter(Boolean).join(', ') || '—'
                  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0)
                  const warehouseNames = Array.from(new Set(lines.map((l) => l.warehouses?.name).filter(Boolean)))
                  const shipment = shipmentByOrder[o.id]
                  return (
                    <tr key={o.id}>
                      {canEdit && (
                        <td className="px-4 py-2.5">
                          <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelected(o.id)} />
                        </td>
                      )}
                      <td className="px-4 py-2.5 font-medium text-slate-700">{o.amazon_order_id}</td>
                      <td className="px-4 py-2.5 text-slate-500">{format(new Date(o.order_date), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-2.5 text-slate-500">{o.channels?.display_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{o.customer_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500 max-w-[160px] truncate" title={skuSummary}>{skuSummary}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{totalQty || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{formatINR(Number(o.gross_amount))}</td>
                      <td className="px-4 py-2.5 text-slate-500">{o.payment_type ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[o.order_status]}`}>
                          {STATUS_LABEL[o.order_status]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{warehouseNames.join(', ') || '—'}</td>
                      <td className="px-4 py-2.5">
                        {canEdit ? (
                          <select
                            value={o.priority}
                            onChange={(e) => updatePriority(o, e.target.value as Enums<'order_priority'>)}
                            disabled={updatingPriorityId === o.id}
                            className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border-0 ${PRIORITY_COLOR[o.priority]}`}
                          >
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                          </select>
                        ) : (
                          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${PRIORITY_COLOR[o.priority]}`}>{o.priority}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {o.sla_due_at ? (
                          <span className={slaState(o) === 'overdue' ? 'text-red-600 font-medium' : slaState(o) === 'due_soon' ? 'text-amber-600 font-medium' : 'text-slate-400'}>
                            {format(new Date(o.sla_due_at), 'dd MMM, HH:mm')}
                            {slaState(o) === 'overdue' && ' (overdue)'}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{shipment ? `${shipment.courier_name} / ${shipment.awb_number}` : '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        {invoiced ? (
                          <Link to="/invoices" className="text-xs text-emerald-600 font-medium hover:underline">
                            Generated
                          </Link>
                        ) : (
                          <button
                            onClick={() => setConfirmInvoiceFor(o)}
                            disabled={generatingId === o.id}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                          >
                            {generatingId === o.id ? 'Generating…' : 'Generate invoice'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && orders.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={totalOrders} onPageChange={setPage} />}
      </div>

      {confirmInvoiceFor && (
        <ConfirmDialog
          title="Generate GST invoice?"
          message={`This permanently consumes the next invoice number for order ${confirmInvoiceFor.amazon_order_id}. Cannot be undone.`}
          confirmLabel="Generate"
          busy={generatingId === confirmInvoiceFor.id}
          onConfirm={() => generateInvoice(confirmInvoiceFor)}
          onCancel={() => setConfirmInvoiceFor(null)}
        />
      )}

      {confirmBulkShip && (
        <ConfirmDialog
          title="Mark orders as shipped?"
          message={`Set shipment status to "shipped" for ${selectedIds.size} order(s)?`}
          confirmLabel="Mark shipped"
          busy={bulkBusy === 'ship'}
          onConfirm={bulkMarkShipped}
          onCancel={() => setConfirmBulkShip(false)}
        />
      )}
    </div>
  )
}

const ACCENTS = {
  indigo: 'from-indigo-500 to-indigo-600',
  purple: 'from-purple-500 to-purple-600',
  amber: 'from-amber-500 to-amber-600',
  red: 'from-red-500 to-red-600',
} as const

function Stat({ label, value, accent }: { label: string; value: string; accent?: keyof typeof ACCENTS }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 sm:p-4 relative overflow-hidden">
      {accent && <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${ACCENTS[accent]}`} />}
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg sm:text-xl font-semibold mt-1 text-slate-900">{value}</div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
      />
    </label>
  )
}

function BulkBtn({ onClick, busy, label }: { onClick: () => void; busy: boolean; label: string }) {
  return (
    <button onClick={onClick} disabled={busy} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50 whitespace-nowrap">
      {label}
    </button>
  )
}
