import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import type { Tables } from './database.types'

type Shipment = Tables<'shipments'> & { orders: Tables<'orders'> | null }
type Organization = Tables<'organizations'>

export function buildManifestPdf(org: Organization, courierName: string, shipments: Shipment[]): Blob {
  const doc = new jsPDF()

  doc.setFontSize(16)
  doc.text('Courier Manifest', 14, 18)
  doc.setFontSize(10)
  doc.text(org.name, 14, 26)
  doc.text(`Courier: ${courierName}`, 14, 32)
  doc.text(`Date: ${format(new Date(), 'dd MMM yyyy')}`, 14, 38)
  doc.text(`Total shipments: ${shipments.length}`, 14, 44)

  autoTable(doc, {
    startY: 52,
    head: [['#', 'Order ID', 'AWB', 'Destination']],
    body: shipments.map((s, i) => [
      String(i + 1),
      s.orders?.amazon_order_id ?? '—',
      s.awb_number,
      s.orders?.ship_address?.split('\n')[0] ?? s.orders?.buyer_state ?? '—',
    ]),
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable.finalY + 20
  doc.setFontSize(9)
  doc.text('Handed over by (signature): _______________________', 14, finalY)
  doc.text('Received by courier (signature): _______________________', 14, finalY + 15)

  return doc.output('blob')
}
