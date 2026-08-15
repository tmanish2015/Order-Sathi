import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Pagination from '../components/Pagination'
import type { Tables } from '../lib/database.types'

type Invoice = Tables<'gst_invoices'> & { orders: Tables<'orders'> | null }
const PAGE_SIZE = 20

export default function Invoices() {
  const { profile } = useAuth()
  const { showError } = useToast()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const orgId = profile?.organization_id

  async function load() {
    if (!orgId) return
    setLoading(true)
    let query = supabase.from('gst_invoices').select('*, orders(*)', { count: 'exact' }).order('issued_at', { ascending: false })
    if (search.trim()) query = query.ilike('invoice_number', `%${search.trim()}%`)
    const { data, count } = await query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    setInvoices((data as unknown as Invoice[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, page, search])

  useEffect(() => {
    setPage(0)
  }, [search])

  async function download(inv: Invoice) {
    if (!inv.pdf_url) return
    setDownloadingId(inv.id)
    const { data, error } = await supabase.storage.from('invoices').createSignedUrl(inv.pdf_url, 60)
    setDownloadingId(null)
    if (error || !data) {
      reportError(showError, 'Download invoice', error ?? { message: 'No signed URL returned' }, orgId, profile?.id)
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">GST Invoices</h2>
      <p className="text-xs text-slate-400 mb-6">One invoice generated per order, split CGST/SGST for intra-state or IGST for inter-state.</p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice #…"
            className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 w-56"
          />
        </div>
        {loading ? (
          <Skeleton />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon="🧾"
            title={search ? 'No invoices match this search.' : 'No invoices generated yet — generate one from the Orders page.'}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2 font-medium">Invoice #</th>
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                <th className="px-4 py-2 font-medium text-right">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-700">{inv.invoice_number}</td>
                  <td className="px-4 py-2.5 text-slate-500">{inv.orders?.amazon_order_id ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{inv.invoice_type === 'intra_state' ? 'CGST+SGST' : 'IGST'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{format(new Date(inv.issued_at), 'dd MMM yyyy')}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{formatINR(Number(inv.total_amount))}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => download(inv)}
                      disabled={downloadingId === inv.id}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                    >
                      {downloadingId === inv.id ? 'Opening…' : 'Download'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && invoices.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
      </div>
    </div>
  )
}
