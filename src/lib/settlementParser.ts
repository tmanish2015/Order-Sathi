import Papa from 'papaparse'

const ORDER_ID_ALIASES = ['order id', 'amazon order id', 'order-id']
const GROSS_ALIASES = ['product sales', 'gross amount', 'gross sales', 'principal']
const FEES_ALIASES = ['selling fees', 'fba fees', 'commission', 'fees']
const TAXES_ALIASES = ['tax collected', 'tds', 'tcs', 'taxes']
const REFUNDS_ALIASES = ['refunds', 'refund amount']
const ADJUSTMENTS_ALIASES = ['other', 'adjustments', 'other transaction fees']
const NET_ALIASES = ['net amount', 'total', 'settlement amount']
const DATE_ALIASES = ['date/time', 'settlement date', 'date']

function normalizeHeader(h: string) {
  return h.trim().toLowerCase()
}

function findColumn(headers: string[], aliases: string[]): string | null {
  const normalized = headers.map(normalizeHeader)
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias)
    if (idx !== -1) return headers[idx]
  }
  return null
}

function toNumber(v: unknown): number {
  if (v == null || v === '') return 0
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

export interface ParsedSettlementTxnRow {
  channelOrderId: string
  gross: number
  fees: number
  taxes: number
  refunds: number
  adjustments: number
  net: number
  settlementDate: string | null
}

export interface ParseSettlementResult {
  rows: ParsedSettlementTxnRow[]
  unmatchedColumns: string[]
}

// Amazon settlement reports list multiple transaction lines per order
// (product charge, fee, refund…) - every column is summed per order rather
// than taking just the first row, same approach as the bank-statement import.
export function parseSettlementCsv(csvText: string): ParseSettlementResult {
  const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  const headers = result.meta.fields ?? []

  const orderCol = findColumn(headers, ORDER_ID_ALIASES)
  if (!orderCol) throw new Error('Could not find an order ID column. Expected one of: ' + ORDER_ID_ALIASES.join(', '))

  const grossCol = findColumn(headers, GROSS_ALIASES)
  const feesCol = findColumn(headers, FEES_ALIASES)
  const taxesCol = findColumn(headers, TAXES_ALIASES)
  const refundsCol = findColumn(headers, REFUNDS_ALIASES)
  const adjustmentsCol = findColumn(headers, ADJUSTMENTS_ALIASES)
  const netCol = findColumn(headers, NET_ALIASES)
  const dateCol = findColumn(headers, DATE_ALIASES)

  const unmatchedColumns: string[] = []
  if (!grossCol) unmatchedColumns.push('gross amount')
  if (!feesCol) unmatchedColumns.push('fees')
  if (!taxesCol) unmatchedColumns.push('taxes')
  if (!refundsCol) unmatchedColumns.push('refunds')
  if (!adjustmentsCol) unmatchedColumns.push('adjustments')
  if (!netCol) unmatchedColumns.push('net amount')

  const totals = new Map<string, ParsedSettlementTxnRow>()
  for (const row of result.data) {
    const orderId = row[orderCol]
    if (!orderId) continue
    const existing = totals.get(orderId) ?? {
      channelOrderId: orderId,
      gross: 0,
      fees: 0,
      taxes: 0,
      refunds: 0,
      adjustments: 0,
      net: 0,
      settlementDate: dateCol ? row[dateCol] || null : null,
    }
    existing.gross += grossCol ? toNumber(row[grossCol]) : 0
    existing.fees += feesCol ? Math.abs(toNumber(row[feesCol])) : 0
    existing.taxes += taxesCol ? Math.abs(toNumber(row[taxesCol])) : 0
    existing.refunds += refundsCol ? Math.abs(toNumber(row[refundsCol])) : 0
    existing.adjustments += adjustmentsCol ? toNumber(row[adjustmentsCol]) : 0
    existing.net += netCol ? toNumber(row[netCol]) : 0
    totals.set(orderId, existing)
  }

  return { rows: Array.from(totals.values()), unmatchedColumns }
}
