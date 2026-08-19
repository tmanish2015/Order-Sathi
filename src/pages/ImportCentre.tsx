import { useEffect, useRef, useState } from 'react'
import Papa from 'papaparse'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables, Enums } from '../lib/database.types'

type Batch = Tables<'import_batches'>
type Warehouse = Tables<'warehouses'>
type Sku = Tables<'skus'>

interface ParsedRow {
  raw: Record<string, string>
  valid: boolean
  error?: string
}

const PRODUCTS_TEMPLATE = 'sku,title,cost_price,gst_rate,hsn_code,buffer_stock\nSKU100,Example Product,199.00,18,HSN1234,10\n'
const OPENING_STOCK_TEMPLATE = 'sku,quantity\nSKU100,50\n'

function downloadTemplate(type: Enums<'import_type'>) {
  const content = type === 'products' ? PRODUCTS_TEMPLATE : OPENING_STOCK_TEMPLATE
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `order-sathi-${type}-template.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ImportCentre() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [importType, setImportType] = useState<Enums<'import_type'>>('products')
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [skus, setSkus] = useState<Sku[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [confirming, setConfirming] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: w }, { data: s }, { data: b }] = await Promise.all([
      supabase.from('warehouses').select('*'),
      supabase.from('skus').select('*'),
      supabase.from('import_batches').select('*').order('created_at', { ascending: false }).limit(20),
    ])
    setWarehouses(w ?? [])
    if (w && w.length > 0 && !warehouseId) setWarehouseId(w.find((x) => x.is_default)?.id ?? w[0].id)
    setSkus(s ?? [])
    setBatches(b ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  function validateRow(raw: Record<string, string>): ParsedRow {
    if (importType === 'products') {
      if (!raw.sku?.trim()) return { raw, valid: false, error: 'Missing sku' }
      if (!raw.title?.trim()) return { raw, valid: false, error: 'Missing title' }
      if (raw.cost_price && Number.isNaN(Number(raw.cost_price))) return { raw, valid: false, error: 'cost_price is not a number' }
      if (raw.gst_rate && Number.isNaN(Number(raw.gst_rate))) return { raw, valid: false, error: 'gst_rate is not a number' }
      return { raw, valid: true }
    }
    // opening_stock
    if (!raw.sku?.trim()) return { raw, valid: false, error: 'Missing sku' }
    if (!skus.some((s) => s.sku === raw.sku.trim())) return { raw, valid: false, error: `SKU "${raw.sku}" doesn't exist — create it first (Products import or Inventory page)` }
    const qty = Number(raw.quantity)
    if (!raw.quantity || Number.isNaN(qty) || qty <= 0) return { raw, valid: false, error: 'quantity must be a positive number' }
    return { raw, valid: true }
  }

  function handleFile(f: File) {
    setFile(f)
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        setRows(result.data.map((raw) => validateRow(raw)))
      },
    })
  }

  const validRows = rows.filter((r) => r.valid)
  const invalidRows = rows.filter((r) => !r.valid)

  async function confirmImport() {
    if (!orgId || !file || validRows.length === 0) return
    setConfirming(true)
    try {
      let successCount = 0
      let errorCount = invalidRows.length

      if (importType === 'products') {
        for (const r of validRows) {
          const { error } = await supabase.from('skus').upsert(
            {
              organization_id: orgId,
              sku: r.raw.sku.trim(),
              title: r.raw.title.trim(),
              cost_price: r.raw.cost_price ? Number(r.raw.cost_price) : 0,
              gst_rate: r.raw.gst_rate ? Number(r.raw.gst_rate) : 18,
              hsn_code: r.raw.hsn_code?.trim() || null,
              buffer_stock: r.raw.buffer_stock ? Number(r.raw.buffer_stock) : 0,
            },
            { onConflict: 'organization_id,sku' }
          )
          if (error) errorCount++
          else successCount++
        }
      } else {
        if (!warehouseId) {
          showError('Select a warehouse first.')
          setConfirming(false)
          return
        }
        const skuIdByCode = new Map(skus.map((s) => [s.sku, s.id]))
        for (const r of validRows) {
          const skuId = skuIdByCode.get(r.raw.sku.trim())
          if (!skuId) {
            errorCount++
            continue
          }
          const { error } = await supabase.from('inventory_ledger').insert({
            organization_id: orgId,
            sku_id: skuId,
            warehouse_id: warehouseId,
            movement_type: 'restock',
            quantity_delta: Number(r.raw.quantity),
            note: `Opening stock import: ${file.name}`,
            created_by: profile!.id,
          })
          if (error) errorCount++
          else successCount++
        }
      }

      await supabase.from('import_batches').insert({
        organization_id: orgId,
        import_type: importType,
        filename: file.name,
        row_count: rows.length,
        success_count: successCount,
        error_count: errorCount,
        imported_by: profile!.id,
      })

      showSuccess(`Imported ${successCount} of ${rows.length} row(s). ${errorCount > 0 ? `${errorCount} failed.` : ''}`)
      setFile(null)
      setRows([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      load()
    } catch (err) {
      reportError(showError, 'Confirm import', err as { message: string }, orgId, profile?.id)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Import Centre</h2>
      <p className="text-xs text-slate-400 mb-6">
        Template → Upload → Validate → Preview → Confirm. Nothing is written until you confirm, and invalid rows are skipped rather than
        corrupting the whole import — you'll see exactly which rows failed and why.
      </p>

      {canEdit && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <label className="block">
              <span className="text-xs text-slate-500">Import type</span>
              <select
                value={importType}
                onChange={(e) => {
                  setImportType(e.target.value as Enums<'import_type'>)
                  setFile(null)
                  setRows([])
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
              >
                <option value="products">Products (create/update SKUs)</option>
                <option value="opening_stock">Opening stock</option>
              </select>
            </label>
            {importType === 'opening_stock' && (
              <label className="block">
                <span className="text-xs text-slate-500">Target warehouse</span>
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5">
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex items-end">
              <button onClick={() => downloadTemplate(importType)} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
                Download template
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="text-sm text-slate-500 mb-4"
          />

          {rows.length > 0 && (
            <>
              <div className="flex gap-4 text-xs mb-2">
                <span className="text-emerald-600 font-medium">{validRows.length} valid</span>
                <span className="text-red-600 font-medium">{invalidRows.length} invalid</span>
                <span className="text-slate-400">{rows.length} total rows</span>
              </div>
              <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg mb-3">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-slate-50">
                    {rows.map((r, i) => (
                      <tr key={i} className={r.valid ? '' : 'bg-red-50'}>
                        <td className="px-2 py-1.5">{r.valid ? '✓' : '✕'}</td>
                        <td className="px-2 py-1.5 font-mono">{JSON.stringify(r.raw)}</td>
                        {!r.valid && <td className="px-2 py-1.5 text-red-600">{r.error}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={confirmImport} disabled={confirming || validRows.length === 0} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
                {confirming ? 'Importing…' : `Confirm import (${validRows.length} row(s))`}
              </button>
            </>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 text-xs font-semibold uppercase text-slate-500">Import history</div>
        {loading ? (
          <Skeleton rows={2} />
        ) : batches.length === 0 ? (
          <EmptyState icon="📥" title="No imports yet." />
        ) : (
          <div className="divide-y divide-slate-50">
            {batches.map((b) => (
              <div key={b.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                <div>
                  <span className="font-medium text-slate-700">{b.filename}</span>
                  <span className="text-slate-400 ml-2 text-xs">{b.import_type.replace('_', ' ')}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {b.success_count}/{b.row_count} succeeded
                  {b.error_count > 0 && <span className="text-red-600"> · {b.error_count} failed</span>}
                  <span className="text-slate-400 ml-2">{format(new Date(b.created_at), 'dd MMM yyyy, HH:mm')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
