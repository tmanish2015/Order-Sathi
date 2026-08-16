import jsPDF from 'jspdf'
import JsBarcode from 'jsbarcode'
import { formatINR } from './format'
import type { Tables } from './database.types'

type Sku = Tables<'skus'>
type Order = Tables<'orders'>
type Organization = Tables<'organizations'>
type LineItem = Tables<'order_line_items'> & { skus: Sku | null }

// Selling price isn't on the SKU record (it's set per-order-line, can vary)
// - callers pass whatever they want printed as the retail price, defaulting
// to cost price plus a visible margin isn't assumed here.
export interface LabelSpec {
  sku: Sku
  copies: number
  price?: number
}

const LABEL_W = 63.5 // mm, standard 3x1" label sheet layout (Avery 5160-style, 3 cols)
const LABEL_H = 25.4
const COLS = 3
const MARGIN = 8

function barcodeDataUrl(text: string): string {
  const canvas = document.createElement('canvas')
  JsBarcode(canvas, text, { format: 'CODE128', displayValue: false, height: 30, margin: 0 })
  return canvas.toDataURL('image/png')
}

export function buildLabelSheetPdf(specs: LabelSpec[]): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const usableW = pageW - MARGIN * 2
  const colGap = (usableW - COLS * LABEL_W) / (COLS - 1)
  const rowsPerPage = Math.floor((pageH - MARGIN * 2) / LABEL_H)

  let col = 0
  let row = 0

  function newRowIfNeeded() {
    if (row >= rowsPerPage) {
      doc.addPage()
      row = 0
    }
  }

  for (const spec of specs) {
    for (let i = 0; i < spec.copies; i++) {
      newRowIfNeeded()
      const x = MARGIN + col * (LABEL_W + colGap)
      const y = MARGIN + row * LABEL_H

      doc.setFontSize(8)
      doc.text(spec.sku.title.slice(0, 30), x + 1, y + 4, { maxWidth: LABEL_W - 2 })
      const barcode = barcodeDataUrl(spec.sku.sku)
      doc.addImage(barcode, 'PNG', x + 1, y + 6, LABEL_W - 2, 10)
      doc.setFontSize(7)
      doc.text(spec.sku.sku, x + 1, y + 19)
      if (spec.price != null) {
        doc.text(formatINR(spec.price), x + LABEL_W - 1, y + 19, { align: 'right' })
      }

      col++
      if (col >= COLS) {
        col = 0
        row++
      }
    }
  }

  return doc.output('blob')
}

export interface ShippingLabelItem {
  order: Order
  lineItems: LineItem[]
}

// A generic printable label, not a courier-format shipping label - no real
// 3PL is wired up (see courier-sync), so there's no carrier tracking
// barcode format to match. Barcode here just encodes the order ID for a
// quick warehouse scan-to-find, nothing a courier would recognize.
export function buildShippingLabelsPdf(org: Organization, items: ShippingLabelItem[]): Blob {
  const doc = new jsPDF()

  items.forEach((item, i) => {
    if (i > 0) doc.addPage()
    const { order, lineItems } = item

    doc.setFontSize(9)
    doc.text('Ship from:', 14, 18)
    doc.setFontSize(11)
    doc.text(org.name, 14, 24)
    doc.setFontSize(9)
    if (org.address) doc.text(doc.splitTextToSize(org.address, 85), 14, 29)

    doc.setFontSize(9)
    doc.text('Ship to:', 110, 18)
    doc.setFontSize(12)
    const addressLines = doc.splitTextToSize(order.ship_address ?? order.buyer_state ?? 'Address not provided', 85)
    doc.text(addressLines, 110, 25)

    const barcode = barcodeDataUrl(order.amazon_order_id)
    doc.addImage(barcode, 'PNG', 14, 55, 90, 20)
    doc.setFontSize(10)
    doc.text(`Order: ${order.amazon_order_id}`, 14, 80)

    doc.setFontSize(9)
    doc.text('Contents:', 14, 92)
    let y = 98
    for (const li of lineItems) {
      doc.text(`${li.skus?.sku ?? '—'} × ${li.quantity} — ${li.skus?.title ?? ''}`.slice(0, 90), 14, y)
      y += 5
    }
  })

  return doc.output('blob')
}
