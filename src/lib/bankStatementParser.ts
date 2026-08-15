import Papa from 'papaparse'

const ORDER_ID_ALIASES = ['order id', 'amazon order id', 'order-id']
const AMOUNT_ALIASES = ['net amount', 'settlement amount', 'net proceeds', 'credit amount', 'amount', 'total']

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

export interface ParsedSettlementRow {
  amazonOrderId: string
  actualSettlement: number
}

export function parseBankStatementCsv(csvText: string): ParsedSettlementRow[] {
  const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  const headers = result.meta.fields ?? []

  const orderCol = findColumn(headers, ORDER_ID_ALIASES)
  const amountCol = findColumn(headers, AMOUNT_ALIASES)

  if (!orderCol) throw new Error('Could not find an order ID column. Expected one of: ' + ORDER_ID_ALIASES.join(', '))
  if (!amountCol) throw new Error('Could not find a settlement amount column. Expected one of: ' + AMOUNT_ALIASES.join(', '))

  // Amazon settlement statements list multiple transaction lines per order
  // (product charge, fee, refund…) — sum every line for a given order to get
  // what actually hit the bank for it, rather than taking just the first row.
  const totals = new Map<string, number>()
  for (const row of result.data) {
    const orderId = row[orderCol]
    if (!orderId) continue
    totals.set(orderId, (totals.get(orderId) ?? 0) + toNumber(row[amountCol]))
  }

  return Array.from(totals.entries()).map(([amazonOrderId, actualSettlement]) => ({ amazonOrderId, actualSettlement }))
}
