import jsPDF from 'jspdf'
import JsBarcode from 'jsbarcode'
import { formatINR } from './format'
import type { Tables } from './database.types'

type Sku = Tables<'skus'>

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
