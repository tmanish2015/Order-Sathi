import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import { calculateInvoice } from '../lib/gstInvoice'
import { buildInvoicePdf } from '../lib/invoicePdf'
import type { Tables } from '../lib/database.types'

type Order = Tables<'orders'> & { channels: Tables<'channels'> | null }
type Channel = Tables<'channels'>
type Organization = Tables<'organizations'>

const STATUS_COLOR: Record<Order['order_status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  shipped: 'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
  returned: 'bg-red-100 text-red-700',
}

export default function Dashboard() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [org, setOrg] = useState<Organization | null>(null)
  const [invoicedOrderIds, setInvoicedOrderIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const orgId = profile?.organization_id

  async function load() {
    if (!orgId) return
    const [{ data: o }, { data: c }, { data: org }, { data: inv }] = await Promise.all([
      supabase.from('orders').select('*, channels(*)').order('order_date', { ascending: false }).limit(50),
      supabase.from('channels').select('*'),
      supabase.from('organizations').select('*').eq('id', orgId).single(),
      supabase.from('gst_invoices').select('order_id'),
    ])
    setOrders((o as unknown as Order[]) ?? [])
    setChannels(c ?? [])
    setOrg(org ?? null)
    setInvoicedOrderIds(new Set((inv ?? []).map((i) => i.order_id)))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function generateInvoice(order: Order) {
    if (!org || !orgId) return
    setGeneratingId(order.id)
    try {
      const { data: lineItems, error: liError } = await supabase
        .from('order_line_items')
        .select('*, skus(*)')
        .eq('order_id', order.id)
      if (liError) throw liError
      if (!lineItems || lineItems.length === 0) {
        showError('No line items on this order — cannot generate an invoice.')
        return
      }

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

      showSuccess(`Invoice ${invoiceNumber} generated.`)
      setInvoicedOrderIds((s) => new Set(s).add(order.id))
    } catch (err) {
      reportError(showError, 'Generate invoice', err as { message: string }, orgId, profile?.id)
    } finally {
      setGeneratingId(null)
    }
  }

  const connectedChannels = channels.filter((c) => c.status === 'connected')
  const gross = orders.reduce((sum, o) => sum + Number(o.gross_amount), 0)
  const pending = orders.filter((o) => o.order_status === 'pending').length
  const shipped = orders.filter((o) => o.order_status === 'shipped').length

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Orders</h2>
          <p className="text-xs text-slate-400 mt-0.5">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
        </div>
        <Link to="/integrations" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700">
          🔌 Connect Amazon
        </Link>
      </div>

      {channels.length === 0 && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
          No Amazon channel connected yet. Orders won't sync until SP-API credentials are added —{' '}
          <Link to="/integrations" className="underline font-medium">connect one here</Link>.
        </div>
      )}

      {org && !org.state && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
          Your organization's state isn't set — GST invoices can't tell CGST/SGST from IGST without it. Set it under{' '}
          <Link to="/team" className="underline font-medium">Team → Organization</Link>.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Stat label="Gross sales (last 50 orders)" value={formatINR(gross)} accent="indigo" />
        <Stat label="Pending" value={String(pending)} accent="amber" />
        <Stat label="Shipped" value={String(shipped)} accent="purple" />
        <Stat label="Channels connected" value={String(connectedChannels.length)} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 text-xs font-semibold uppercase text-slate-500">
          Recent orders
        </div>
        {loading ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">Order ID</th>
                  <th className="px-4 py-2 font-medium">Channel</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium text-right">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {orders.map((o) => {
                  const invoiced = invoicedOrderIds.has(o.id)
                  return (
                    <tr key={o.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-700">{o.amazon_order_id}</td>
                      <td className="px-4 py-2.5 text-slate-500">{o.channels?.display_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{format(new Date(o.order_date), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[o.order_status]}`}>
                          {o.order_status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{formatINR(Number(o.gross_amount))}</td>
                      <td className="px-4 py-2.5 text-right">
                        {invoiced ? (
                          <Link to="/invoices" className="text-xs text-emerald-600 font-medium hover:underline">
                            Generated
                          </Link>
                        ) : (
                          <button
                            onClick={() => generateInvoice(o)}
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
      </div>
    </div>
  )
}

const ACCENTS = {
  indigo: 'from-indigo-500 to-indigo-600',
  purple: 'from-purple-500 to-purple-600',
  amber: 'from-amber-500 to-amber-600',
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
