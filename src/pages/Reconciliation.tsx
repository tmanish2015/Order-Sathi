import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import { parseMtrCsv } from '../lib/mtrParser'
import { parseBankStatementCsv } from '../lib/bankStatementParser'
import { parseSettlementCsv } from '../lib/settlementParser'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Entry = Tables<'reconciliation_entries'> & { orders: Tables<'orders'> | null }
type Channel = Tables<'channels'>
type SettlementTxn = Tables<'settlement_transactions'> & { orders: Tables<'orders'> | null }

const STATUS_COLOR: Record<Entry['status'], string> = {
  matched: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  mismatch: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  pending_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  resolved: 'bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300',
  ignored: 'bg-slate-100 text-slate-400 dark:bg-slate-900/40 dark:text-slate-500',
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
  const [importingBank, setImportingBank] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<Entry['status'] | ''>('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bankFileInputRef = useRef<HTMLInputElement>(null)

  const [settlements, setSettlements] = useState<SettlementTxn[]>([])
  const [settlementChannel, setSettlementChannel] = useState('')
  const [importingSettlement, setImportingSettlement] = useState(false)
  const settlementFileInputRef = useRef<HTMLInputElement>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [resolveNote, setResolveNote] = useState('')

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'finance'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: e }, { data: c }, { data: s }] = await Promise.all([
      supabase.from('reconciliation_entries').select('*, orders(*)').order('created_at', { ascending: false }),
      supabase.from('channels').select('*'),
      supabase.from('settlement_transactions').select('*, orders(*)').order('created_at', { ascending: false }),
    ])
    setEntries((e as unknown as Entry[]) ?? [])
    setChannels(c ?? [])
    setSettlements((s as unknown as SettlementTxn[]) ?? [])
    if (c && c.length === 1) {
      setSelectedChannel(c[0].id)
      setSettlementChannel(c[0].id)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function handleSettlementFile(file: File) {
    if (!orgId || !settlementChannel) return
    setImportingSettlement(true)
    try {
      const text = await file.text()
      const { rows, unmatchedColumns } = parseSettlementCsv(text)
      if (rows.length === 0) throw new Error('No usable rows found in this file.')

      const settlementId = `${file.name}-${Date.now()}`
      const orderIds = rows.map((r) => r.channelOrderId)
      const { data: orders } = await supabase
        .from('orders')
        .select('id, amazon_order_id')
        .eq('channel_id', settlementChannel)
        .in('amazon_order_id', orderIds)
      const orderByChannelOrderId = new Map((orders ?? []).map((o) => [o.amazon_order_id, o.id]))

      const matchedOrderIds = Array.from(orderByChannelOrderId.values())
      const { data: existingEntries } = await supabase.from('reconciliation_entries').select('order_id, expected_settlement').in('order_id', matchedOrderIds)
      const entryByOrderId = new Map((existingEntries ?? []).map((e) => [e.order_id, e]))

      let matched = 0
      let mismatched = 0
      const txnRows = rows.map((r) => {
        const orderId = orderByChannelOrderId.get(r.channelOrderId) ?? null
        let matchStatus: Entry['status'] = 'pending_review'
        let matchNote: string | null = null
        if (!orderId) {
          matchNote = 'No matching order found for this channel order ID.'
        } else {
          const reconEntry = entryByOrderId.get(orderId)
          if (!reconEntry) {
            matchNote = 'Order found, but no MTR reconciliation entry to compare against yet.'
          } else if (Math.abs(r.net - Number(reconEntry.expected_settlement)) <= MISMATCH_THRESHOLD) {
            matchStatus = 'matched'
            matched++
          } else {
            matchStatus = 'mismatch'
            mismatched++
            matchNote = `Expected ${formatINR(Number(reconEntry.expected_settlement))}, settlement reports ${formatINR(r.net)}.`
          }
        }
        return {
          organization_id: orgId,
          channel_id: settlementChannel,
          settlement_id: settlementId,
          order_id: orderId,
          channel_order_id: r.channelOrderId,
          gross_amount: r.gross,
          fees: r.fees,
          taxes: r.taxes,
          refunds: r.refunds,
          adjustments: r.adjustments,
          net_amount: r.net,
          settlement_date: r.settlementDate,
          match_status: matchStatus,
          match_note: matchNote,
        }
      })

      const { error: insertError } = await supabase.from('settlement_transactions').insert(txnRows)
      if (insertError) throw insertError

      const unmatched = rows.length - matched - mismatched
      const messageParts = [`${matched} matched, ${mismatched} mismatched, ${unmatched} pending review of ${rows.length} settlement rows.`]
      if (unmatchedColumns.length > 0) messageParts.push(`Columns not found in file (defaulted to 0): ${unmatchedColumns.join(', ')}.`)

      await supabase.from('sync_logs').insert({
        organization_id: orgId,
        channel_id: settlementChannel,
        operation: 'settlement_import',
        sync_type: 'settlement',
        status: mismatched > 0 || unmatched > 0 ? 'partial' : 'success',
        fault: mismatched > 0 || unmatched > 0 ? 'seller_data' : null,
        message: messageParts.join(' '),
      })

      showSuccess(`Imported ${file.name}: ${messageParts[0]}`)
      load()
    } catch (err) {
      reportError(showError, 'Settlement import', err as { message: string }, orgId, profile?.id)
    } finally {
      setImportingSettlement(false)
      if (settlementFileInputRef.current) settlementFileInputRef.current.value = ''
    }
  }

  async function resolveSettlement(t: SettlementTxn, status: 'resolved' | 'ignored') {
    if (!resolveNote.trim()) {
      showError('A note is required before resolving or ignoring a mismatch.')
      return
    }
    setResolvingId(t.id)
    const { error } = await supabase
      .from('settlement_transactions')
      .update({ match_status: status, match_note: resolveNote.trim() })
      .eq('id', t.id)
    setResolvingId(null)
    if (error) {
      reportError(showError, 'Resolve settlement exception', error, orgId, profile?.id)
      return
    }
    setResolveNote('')
    load()
  }

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

  async function handleBankFile(file: File) {
    if (!orgId) return
    setImportingBank(true)
    try {
      const text = await file.text()
      const rows = parseBankStatementCsv(text)
      if (rows.length === 0) throw new Error('No usable rows found in this file.')

      const orderIds = rows.map((r) => r.amazonOrderId)
      const { data: orders } = await supabase.from('orders').select('id, amazon_order_id').in('amazon_order_id', orderIds)
      const orderIdByAmazonId = new Map((orders ?? []).map((o) => [o.amazon_order_id, o.id]))

      const matchedOrderIds = rows.map((r) => orderIdByAmazonId.get(r.amazonOrderId)).filter((id): id is string => !!id)
      const { data: existingEntries } = await supabase.from('reconciliation_entries').select('*').in('order_id', matchedOrderIds)
      const entryByOrderId = new Map((existingEntries ?? []).map((e) => [e.order_id, e]))

      let updated = 0
      const updateRows = []
      for (const row of rows) {
        const orderId = orderIdByAmazonId.get(row.amazonOrderId)
        const entry = orderId ? entryByOrderId.get(orderId) : undefined
        if (!entry) continue
        updated++
        const status: Entry['status'] = Math.abs(row.actualSettlement - Number(entry.expected_settlement)) <= MISMATCH_THRESHOLD ? 'matched' : 'mismatch'
        updateRows.push({ ...entry, actual_settlement: row.actualSettlement, status, reviewed_by: profile!.id, reviewed_at: new Date().toISOString() })
      }

      if (updateRows.length > 0) {
        const { error } = await supabase.from('reconciliation_entries').upsert(updateRows, { onConflict: 'order_id' })
        if (error) throw error
      }

      const unmatched = rows.length - updated
      const messageParts = [`${updated} of ${rows.length} rows matched an existing reconciliation entry.`]
      if (unmatched > 0) messageParts.push(`${unmatched} unmatched — no order, or MTR not yet imported for it.`)

      await supabase.from('sync_logs').insert({
        organization_id: orgId,
        operation: 'bank_settlement_import',
        status: unmatched > 0 ? 'partial' : 'success',
        fault: unmatched > 0 ? 'seller_data' : null,
        message: messageParts.join(' '),
      })

      showSuccess(`Imported ${file.name}: ${updated} of ${rows.length} orders matched.`)
      load()
    } catch (err) {
      reportError(showError, 'Bank statement import', err as { message: string }, orgId, profile?.id)
    } finally {
      setImportingBank(false)
      if (bankFileInputRef.current) bankFileInputRef.current.value = ''
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
  const visibleEntries = statusFilter ? entries.filter((e) => e.status === statusFilter) : entries

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">MTR Reconciliation</h2>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        Gross sales feed the revenue ledger. Actual settlement is tracked separately — the two never get merged directly. Any mismatch is flagged for manual review, never silently accepted.
      </p>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 mb-6">
        <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-3">Import MTR file</div>
        {channels.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No channel connected yet — connect Amazon under Integrations first.</p>
        ) : (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {channels.length > 1 && (
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="text-sm rounded-lg border border-slate-300 px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
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
              className="text-sm text-slate-500 dark:text-slate-400 disabled:opacity-50"
            />
            {importing && <span className="text-xs text-slate-400 dark:text-slate-500">Importing…</span>}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 mb-6">
        <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">Import bank settlement statement</div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          Bulk-fills actual settlement for every order in the file, matched by Order ID. Requires MTR already imported for those orders.
        </p>
        <div className="flex items-center gap-3">
          <input
            ref={bankFileInputRef}
            type="file"
            accept=".csv"
            disabled={importingBank}
            onChange={(e) => e.target.files?.[0] && handleBankFile(e.target.files[0])}
            className="text-sm text-slate-500 dark:text-slate-400 disabled:opacity-50"
          />
          {importingBank && <span className="text-xs text-slate-400 dark:text-slate-500">Importing…</span>}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 mb-6">
        <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">Import settlement file</div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          Matches each settlement row to an order by channel order ID, then compares net settlement against the MTR expected
          amount. Anything unmatched or off goes straight to the exception queue below — never silently accepted.
        </p>
        {channels.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No channel connected yet — connect Amazon under Integrations first.</p>
        ) : (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {channels.length > 1 && (
              <select
                value={settlementChannel}
                onChange={(e) => setSettlementChannel(e.target.value)}
                className="text-sm rounded-lg border border-slate-300 px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
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
              ref={settlementFileInputRef}
              type="file"
              accept=".csv"
              disabled={!settlementChannel || importingSettlement}
              onChange={(e) => e.target.files?.[0] && handleSettlementFile(e.target.files[0])}
              className="text-sm text-slate-500 dark:text-slate-400 disabled:opacity-50"
            />
            {importingSettlement && <span className="text-xs text-slate-400 dark:text-slate-500">Importing…</span>}
          </div>
        )}
      </div>

      {settlements.filter((t) => t.match_status === 'mismatch' || t.match_status === 'pending_review').length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-red-200 shadow-sm p-4 mb-6">
          <div className="text-xs font-semibold uppercase text-red-600 mb-3">
            Reconciliation exception queue — {settlements.filter((t) => t.match_status === 'mismatch' || t.match_status === 'pending_review').length} open
          </div>
          <div className="space-y-3">
            {settlements
              .filter((t) => t.match_status === 'mismatch' || t.match_status === 'pending_review')
              .map((t) => (
                <div key={t.id} className="border border-slate-100 dark:border-slate-700/60 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-sm">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{t.channel_order_id}</span>{' '}
                      <span className={`ml-2 text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[t.match_status]}`}>
                        {t.match_status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Net {formatINR(Number(t.net_amount))} · Fees {formatINR(Number(t.fees))} · Taxes {formatINR(Number(t.taxes))} · Refunds{' '}
                      {formatINR(Number(t.refunds))}
                    </div>
                  </div>
                  {t.match_note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.match_note}</p>}
                  {canEdit && (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="text"
                        placeholder="Resolution note (required)"
                        value={resolvingId === t.id ? resolveNote : ''}
                        onFocus={() => setResolvingId(t.id)}
                        onChange={(e) => setResolveNote(e.target.value)}
                        className="flex-1 text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                      />
                      <button onClick={() => resolveSettlement(t, 'resolved')} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                        Resolve
                      </button>
                      <button onClick={() => resolveSettlement(t, 'ignored')} className="text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600">
                        Ignore
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {mismatches.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6 text-sm text-red-800">
          {mismatches.length} order{mismatches.length > 1 ? 's' : ''} with a settlement mismatch — needs manual review.
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as Entry['status'] | '')}
            className="text-sm rounded-lg border border-slate-300 px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
          >
            <option value="">All statuses</option>
            <option value="pending_review">Pending review</option>
            <option value="matched">Matched</option>
            <option value="mismatch">Mismatch</option>
            <option value="resolved">Resolved</option>
            <option value="ignored">Ignored</option>
          </select>
        </div>
        {loading ? (
          <Skeleton />
        ) : entries.length === 0 ? (
          <EmptyState icon="🔄" title="No MTR file imported yet." />
        ) : visibleEntries.length === 0 ? (
          <EmptyState icon="🔄" title="No entries match this filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700/60">
                  <th className="px-4 py-2 font-medium">Order</th>
                  <th className="px-4 py-2 font-medium text-right">Gross sales</th>
                  <th className="px-4 py-2 font-medium text-right">Commission</th>
                  <th className="px-4 py-2 font-medium text-right">TCS</th>
                  <th className="px-4 py-2 font-medium text-right">TDS 194O</th>
                  <th className="px-4 py-2 font-medium text-right">Expected settle</th>
                  <th className="px-4 py-2 font-medium text-right">Actual settle</th>
                  <th className="px-4 py-2 font-medium">Reconciliation status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                {visibleEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{e.orders?.amazon_order_id ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{formatINR(Number(e.gross_sales))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{formatINR(Number(e.commission))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">
                      {formatINR(Number(e.tcs_cgst) + Number(e.tcs_sgst) + Number(e.tcs_igst))}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{formatINR(Number(e.tds_194o))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{formatINR(Number(e.expected_settlement))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">
                      {editingId === e.id ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="number"
                            autoFocus
                            value={editValue}
                            onChange={(ev) => setEditValue(ev.target.value)}
                            className="w-24 text-right text-sm rounded-lg border border-slate-300 px-2 py-1 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                          />
                          <button
                            onClick={() => saveActualSettlement(e)}
                            disabled={savingId === e.id}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                          >
                            {savingId === e.id ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600">
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
