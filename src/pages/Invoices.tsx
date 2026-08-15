import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import type { Tables } from '../lib/database.types'

type Invoice = Tables<'gst_invoices'> & { orders: Tables<'orders'> | null }

export default function Invoices() {
  const { profile } = useAuth()
  const { showError } = useToast()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      const { data } = await supabase.from('gst_invoices').select('*, orders(*)').order('issued_at', { ascending: false })
      setInvoices((data as unknown as Invoice[]) ?? [])
    })()
  }, [orgId])

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
        {invoices.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">
            No invoices generated yet — generate one from the Orders page.
          </p>
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
      </div>
    </div>
  )
}
