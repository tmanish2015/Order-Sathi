import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import { parseMtrCsv } from '../lib/mtrParser'
import type { Tables } from '../lib/database.types'

type Entry = Tables<'reconciliation_entries'> & { orders: Tables<'orders'> | null }
type Channel = Tables<'channels'>

const STATUS_COLOR: Record<Entry['status'], string> = {
  matched: 'bg-emerald-100 text-emerald-700',
  mismatch: 'bg-red-100 text-red-700',
  pending_review: 'bg-amber-100 text-amber-700',
}

// Bank credits round differently than the paise-precise settlement math -
// anything within ₹2 counts as matched rather than flagging every order.
const MISMATCH_THRESHOLD = 2

export default function Reconciliation() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [entries, setEntries] = useState<Entry[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannel, setSelectedChannel] = useState('')
  const [importing, setImporting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'finance'

  async function load() {
    if (!orgId) return
    const [{ data: e }, { data: c }] = await Promise.all([
      supabase.from('reconciliation_entries').select('*, orders(*)').order('created_at', { ascending: false }),
      supabase.from('channels').select('*'),
    ])
    setEntries((e as unknown as Entry[]) ?? [])
    setChannels(c ?? [])
    if (c && c.length === 1) setSelectedChannel(c[0].id)
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function handleFile(file: File) {
    if (!orgId || !selectedChannel) return
    setImporting(true)
    try {
      const text = await file.text()
      const { rows, unmatchedColumns } = parseMtrCsv(text)
      if (rows.length === 0) throw new Error('No usable rows found in this file.')

      const { data: mtrImport, error: importError } = await supabase
        .from('mtr_imports')
        .insert({ organization_id: orgId, channel_id: selectedChannel, filename: file.name, row_count: rows.length, uploaded_by: profile!.id })
        .select()
        .single()
      if (importError || !mtrImport) throw importError ?? new Error('Could not create import record')

      const { data: lineItems, error: liError } = await supabase
        .from('mtr_line_items')
        .insert(rows.map((r) => ({ organization_id: orgId, mtr_import_id: mtrImport.id, amazon_order_id: r.amazonOrderId, raw_row: r.raw })))
        .select()
      if (liError || !lineItems) throw liError ?? new Error('Could not save MTR rows')

      const orderIds = rows.map((r) => r.amazonOrderId)
      const { data: orders } = await supabase.from('orders').select('id, amazon_order_id').eq('channel_id', selectedChannel).in('amazon_order_id', orderIds)
      const orderByAmazonId = new Map((orders ?? []).map((o) => [o.amazon_order_id, o.id]))
      const lineItemByAmazonId = new Map(lineItems.map((li) => [li.amazon_order_id, li.id]))

      let matched = 0
      const reconRows = []
      for (const row of rows) {
        const orderId = orderByAmazonId.get(row.amazonOrderId)
        if (!orderId) continue
        matched++
        const totalTax = row.tcsCgst + row.tcsSgst + row.tcsIgst
        reconRows.push({
          organization_id: orgId,
          order_id: orderId,
          mtr_line_item_id: lineItemByAmazonId.get(row.amazonOrderId) ?? null,
          gross_sales: row.grossAmount,
          commission: row.commission,
          tcs_cgst: row.tcsCgst,
          tcs_sgst: row.tcsSgst,
          tcs_igst: row.tcsIgst,
          tds_194o: row.tds,
          other_fees: row.otherFees,
          expected_settlement: row.grossAmount - row.commission - totalTax - row.tds - row.otherFees,
          status: 'pending_review' as const,
        })
      }

      if (reconRows.length > 0) {
        const { error: reconError } = await supabase.from('reconciliation_entries').upsert(reconRows, { onConflict: 'order_id' })
        if (reconError) throw reconError
      }

      const unmatched = rows.length - matched
      const messageParts = [`${matched} of ${rows.length} rows matched to known orders.`]
      if (unmatched > 0) messageParts.push(`${unmatched} unmatched — order not found for this channel.`)
      if (unmatchedColumns.length > 0) messageParts.push(`Columns not found in file (defaulted to 0): ${unmatchedColumns.join(', ')}.`)

      await supabase.from('sync_logs').insert({
        organization_id: orgId,
        channel_id: selectedChannel,
        operation: 'mtr_import',
        status: unmatched > 0 || unmatchedColumns.length > 0 ? 'partial' : 'success',
        fault: unmatched > 0 ? 'seller_data' : null,
        message: messageParts.join(' '),
      })

      showSuccess(`Imported ${file.name}: ${matched} of ${rows.length} orders reconciled.`)
      load()
    } catch (err) {
      reportError(showError, 'MTR import', err as { message: string }, orgId, profile?.id)
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function startEdit(e: Entry) {
    setEditingId(e.id)
    setEditValue(e.actual_settlement != null ? String(e.actual_settlement) : '')
  }

  async function saveActualSettlement(e: Entry) {
    const actual = Number(editValue)
    if (!Number.isFinite(actual)) {
      showError('Enter a valid number.')
      return
    }
    setSavingId(e.id)
    const status = Math.abs(actual - Number(e.expected_settlement)) <= MISMATCH_THRESHOLD ? 'matched' : 'mismatch'
    const { error } = await supabase
      .from('reconciliation_entries')
      .update({ actual_settlement: actual, status, reviewed_by: profile!.id, reviewed_at: new Date().toISOString() })
      .eq('id', e.id)
    setSavingId(null)
    if (error) {
      reportError(showError, 'Save settlement', error, orgId, profile?.id)
      return
    }
    setEditingId(null)
    load()
  }

  const mismatches = entries.filter((e) => e.status === 'mismatch')

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">MTR Reconciliation</h2>
      <p className="text-xs text-slate-400 mb-6">
        Gross sales feed the revenue ledger. Actual settlement is tracked separately — the two never get merged directly. Any mismatch is flagged for manual review, never silently accepted.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
        <div className="text-xs font-semibold uppercase text-slate-500 mb-3">Import MTR file</div>
        {channels.length === 0 ? (
          <p className="text-sm text-slate-400">No channel connected yet — connect Amazon under Integrations first.</p>
        ) : (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {channels.length > 1 && (
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="text-sm rounded-lg border border-slate-300 px-2 py-1.5"
              >
                <option value="">Select channel…</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              disabled={!selectedChannel || importing}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="text-sm text-slate-500 disabled:opacity-50"
            />
            {importing && <span className="text-xs text-slate-400">Importing…</span>}
          </div>
        )}
      </div>

      {mismatches.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-800">
          {mismatches.length} order{mismatches.length > 1 ? 's' : ''} with a settlement mismatch — needs manual review.
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No MTR file imported yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">Order</th>
                  <th className="px-4 py-2 font-medium text-right">Gross sales</th>
                  <th className="px-4 py-2 font-medium text-right">Commission</th>
                  <th className="px-4 py-2 font-medium text-right">TCS</th>
                  <th className="px-4 py-2 font-medium text-right">TDS 194O</th>
                  <th className="px-4 py-2 font-medium text-right">Expected settle</th>
                  <th className="px-4 py-2 font-medium text-right">Actual settle</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{e.orders?.amazon_order_id ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{formatINR(Number(e.gross_sales))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatINR(Number(e.commission))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">
                      {formatINR(Number(e.tcs_cgst) + Number(e.tcs_sgst) + Number(e.tcs_igst))}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatINR(Number(e.tds_194o))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatINR(Number(e.expected_settlement))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">
                      {editingId === e.id ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="number"
                            autoFocus
                            value={editValue}
                            onChange={(ev) => setEditValue(ev.target.value)}
                            className="w-24 text-right text-sm rounded-lg border border-slate-300 px-2 py-1"
                          />
                          <button
                            onClick={() => saveActualSettlement(e)}
                            disabled={savingId === e.id}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                          >
                            {savingId === e.id ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-slate-600">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => canEdit && startEdit(e)}
                          disabled={!canEdit}
                          className={canEdit ? 'hover:underline' : ''}
                        >
                          {e.actual_settlement != null ? formatINR(Number(e.actual_settlement)) : canEdit ? 'Enter…' : '—'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[e.status]}`}>
                        {e.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
