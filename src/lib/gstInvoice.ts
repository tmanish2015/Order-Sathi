import type { Tables } from './database.types'

type Sku = Tables<'skus'>
type LineItem = Tables<'order_line_items'> & { skus: Sku | null }

export interface InvoiceCalc {
  invoiceType: 'intra_state' | 'inter_state'
  taxableValue: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  totalAmount: number
  lines: {
    title: string
    sku: string
    quantity: number
    unitPrice: number
    gstRate: number
    lineTaxable: number
    lineTax: number
  }[]
}

// Amazon's line-item price is GST-inclusive. Taxable value per line is
// backed out from the inclusive price using the SKU's own GST rate — each
// line can carry a different rate, so this can't be done on the order total.
export function calculateInvoice(orgState: string | null, buyerState: string | null, lineItems: LineItem[]): InvoiceCalc {
  const interState = !!orgState && !!buyerState && orgState.trim().toLowerCase() !== buyerState.trim().toLowerCase()
  const invoiceType: InvoiceCalc['invoiceType'] = interState ? 'inter_state' : 'intra_state'

  let taxableValue = 0
  let totalTax = 0
  const lines: InvoiceCalc['lines'] = []

  for (const item of lineItems) {
    const gstRate = Number(item.skus?.gst_rate ?? 18)
    const inclusiveAmount = Number(item.unit_price) * item.quantity
    const lineTaxable = inclusiveAmount / (1 + gstRate / 100)
    const lineTax = inclusiveAmount - lineTaxable

    taxableValue += lineTaxable
    totalTax += lineTax
    lines.push({
      title: item.skus?.title ?? 'Unknown item',
      sku: item.skus?.sku ?? '—',
      quantity: item.quantity,
      unitPrice: Number(item.unit_price),
      gstRate,
      lineTaxable,
      lineTax,
    })
  }

  const cgstAmount = interState ? 0 : totalTax / 2
  const sgstAmount = interState ? 0 : totalTax / 2
  const igstAmount = interState ? totalTax : 0

  return {
    invoiceType,
    taxableValue,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalAmount: taxableValue + totalTax,
    lines,
  }
}
