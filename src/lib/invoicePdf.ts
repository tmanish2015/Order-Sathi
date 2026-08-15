import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import { formatINR } from './format'
import type { Tables } from './database.types'
import type { InvoiceCalc } from './gstInvoice'

type Organization = Tables<'organizations'>
type Order = Tables<'orders'>

export function buildInvoicePdf(org: Organization, order: Order, invoiceNumber: string, calc: InvoiceCalc): Blob {
  const doc = new jsPDF()

  doc.setFontSize(16)
  doc.text('Tax Invoice', 14, 18)

  doc.setFontSize(10)
  doc.text(org.name, 14, 28)
  if (org.address) doc.text(org.address, 14, 33)
  if (org.gst_number) doc.text(`GSTIN: ${org.gst_number}`, 14, 38)
  if (org.state) doc.text(`State: ${org.state}`, 14, 43)

  doc.text(`Invoice #: ${invoiceNumber}`, 140, 28)
  doc.text(`Order ID: ${order.amazon_order_id}`, 140, 33)
  doc.text(`Date: ${format(new Date(order.order_date), 'dd MMM yyyy')}`, 140, 38)
  doc.text(`Place of supply: ${order.buyer_state ?? '—'}`, 140, 43)

  autoTable(doc, {
    startY: 52,
    head: [['SKU', 'Item', 'Qty', 'Unit Price', 'GST %', 'Taxable', 'Tax']],
    body: calc.lines.map((l) => [
      l.sku,
      l.title,
      String(l.quantity),
      formatINR(l.unitPrice),
      `${l.gstRate}%`,
      formatINR(l.lineTaxable),
      formatINR(l.lineTax),
    ]),
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable.finalY + 10
  doc.setFontSize(10)
  doc.text(`Taxable value: ${formatINR(calc.taxableValue)}`, 140, finalY)
  if (calc.invoiceType === 'intra_state') {
    doc.text(`CGST: ${formatINR(calc.cgstAmount)}`, 140, finalY + 5)
    doc.text(`SGST: ${formatINR(calc.sgstAmount)}`, 140, finalY + 10)
  } else {
    doc.text(`IGST: ${formatINR(calc.igstAmount)}`, 140, finalY + 5)
  }
  doc.setFontSize(11)
  doc.text(`Total: ${formatINR(calc.totalAmount)}`, 140, finalY + 18)

  return doc.output('blob')
}
