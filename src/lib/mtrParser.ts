import Papa from 'papaparse'
import type { Json } from './database.types'

// Amazon exports several different reports under the "MTR" umbrella and
// sellers rename columns across templates — match by alias list rather than
// a fixed header name, so a slightly different export still parses.
const COLUMN_ALIASES: Record<string, string[]> = {
  orderId: ['order id', 'amazon order id', 'order-id'],
  grossAmount: ['invoice amount', 'gross amount', 'total invoice amount', 'total amount', 'principal amount'],
  commission: ['selling fees', 'commission', 'referral fee'],
  tcsCgst: ['tcs cgst amount', 'cgst tcs'],
  tcsSgst: ['tcs sgst amount', 'sgst tcs'],
  tcsIgst: ['tcs igst amount', 'igst tcs'],
  tds: ['tds amount', 'tds', 'tds 194o'],
  otherFees: ['other transaction fees', 'fba fees', 'shipping fee', 'other fees'],
}

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

export interface ParsedMtrRow {
  amazonOrderId: string
  grossAmount: number
  commission: number
  tcsCgst: number
  tcsSgst: number
  tcsIgst: number
  tds: number
  otherFees: number
  raw: Json
}

export interface ParsedMtr {
  rows: ParsedMtrRow[]
  unmatchedColumns: string[] // fields we couldn't find a header for
}

export function parseMtrCsv(csvText: string): ParsedMtr {
  const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  const headers = result.meta.fields ?? []

  const colMap: Record<string, string | null> = {}
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    colMap[field] = findColumn(headers, aliases)
  }

  const unmatchedColumns = Object.entries(colMap)
    .filter(([field, col]) => field !== 'orderId' && col === null)
    .map(([field]) => field)

  if (!colMap.orderId) {
    throw new Error('Could not find an order ID column in this file. Expected one of: ' + COLUMN_ALIASES.orderId.join(', '))
  }

  const rows: ParsedMtrRow[] = result.data
    .filter((row) => row[colMap.orderId!])
    .map((row) => ({
      amazonOrderId: row[colMap.orderId!],
      grossAmount: toNumber(colMap.grossAmount ? row[colMap.grossAmount] : 0),
      commission: toNumber(colMap.commission ? row[colMap.commission] : 0),
      tcsCgst: toNumber(colMap.tcsCgst ? row[colMap.tcsCgst] : 0),
      tcsSgst: toNumber(colMap.tcsSgst ? row[colMap.tcsSgst] : 0),
      tcsIgst: toNumber(colMap.tcsIgst ? row[colMap.tcsIgst] : 0),
      tds: toNumber(colMap.tds ? row[colMap.tds] : 0),
      otherFees: toNumber(colMap.otherFees ? row[colMap.otherFees] : 0),
      raw: row,
    }))

  return { rows, unmatchedColumns }
}
