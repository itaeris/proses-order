import { orderCount, saveOrder, type ProcessSeed } from './store.js'
import type { NormalizedOrder } from './shopify.js'

function ago(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

function ahead(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function order(partial: NormalizedOrder): NormalizedOrder {
  return partial
}

function items(lines: Array<[string, number]>) {
  return JSON.stringify(lines.map(([name, quantity]) => ({ name, quantity, sku: null })))
}

export async function seedIfEmpty() {
  if ((await orderCount()) > 0) return
  const readyAt = ago(1)
  const rows: Array<{ order: NormalizedOrder; process: ProcessSeed }> = [
    {
      order: order({
        id: 'sample-1',
        name: '#AB6560',
        createdAt: ago(2),
        customerName: 'Annabella Putri',
        totalAmount: '284250',
        currency: 'IDR',
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        fulfillBy: ahead(20),
        itemCount: 2,
        itemsJson: items([
          ['Kemeja linen putih', 1],
          ['Celana wide leg', 1],
        ]),
        deliveryMethod: 'POS - POS REGULER',
        shippingCountry: 'ID',
        shippingCity: 'Bandung',
        shippingAddress: 'Annabella Putri, Jl. Dago No. 12, Bandung, 40135, ID',
        salesChannel: 'Online Store',
        trackingNumber: null,
      }),
      process: { channel: 'indocolite' },
    },
    {
      order: order({
        id: 'sample-2',
        name: '#AB6559',
        createdAt: ago(26),
        customerName: 'Ayu Fauziah',
        totalAmount: '379000',
        currency: 'IDR',
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        fulfillBy: ago(2),
        itemCount: 1,
        itemsJson: items([['Dress satin hitam', 1]]),
        deliveryMethod: 'POS - POS NEXTDAY',
        shippingCountry: 'ID',
        shippingCity: 'Surabaya',
        shippingAddress: 'Ayu Fauziah, Jl. Pemuda 8, Surabaya, 60271, ID',
        salesChannel: 'Online Store',
        trackingNumber: null,
      }),
      process: { channel: 'indocolite' },
    },
    {
      order: order({
        id: 'sample-3',
        name: '#AB6558',
        createdAt: ago(5),
        customerName: 'Fagita Ananda',
        totalAmount: '305000',
        currency: 'IDR',
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        fulfillBy: ahead(18),
        itemCount: 2,
        itemsJson: items([
          ['Blazer oversized', 1],
          ['Ikat pinggang', 1],
        ]),
        deliveryMethod: 'JNE - Reguler',
        shippingCountry: 'ID',
        shippingCity: 'Jakarta Selatan',
        shippingAddress: 'Fagita Ananda, Jl. Fatmawati 21, Jakarta Selatan, 12420, ID',
        salesChannel: 'Online Store',
        trackingNumber: 'JP9988123456',
      }),
      process: {
        channel: 'biteship',
        channelStep: 'import_shopify',
        warehouseStep: 'validasi_awb',
        assignee: 'Rina',
      },
    },
    {
      order: order({
        id: 'sample-4',
        name: '#AB6547',
        createdAt: ago(30),
        customerName: 'Valencia Chandra',
        totalAmount: '379000',
        currency: 'IDR',
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        fulfillBy: ago(6),
        itemCount: 1,
        itemsJson: items([['Kaos boxy cream', 1]]),
        deliveryMethod: 'JNE - Reguler',
        shippingCountry: 'ID',
        shippingCity: 'Tangerang',
        shippingAddress: 'Valencia Chandra, Cluster Melati B3, Tangerang, 15138, ID',
        salesChannel: 'Online Store',
        trackingNumber: null,
      }),
      process: {
        channel: 'biteship',
        channelStep: 'bayar',
        channelDone: 1,
        warehouseStep: 'validasi_awb',
        assignee: 'Dimas',
      },
    },
    {
      order: order({
        id: 'sample-5',
        name: '#AB6536',
        createdAt: ago(8),
        customerName: 'Andi Risma',
        totalAmount: '505260',
        currency: 'IDR',
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        fulfillBy: ahead(10),
        itemCount: 3,
        itemsJson: items([
          ['Kemeja stripe', 2],
          ['Topi bucket', 1],
        ]),
        deliveryMethod: 'LION PARCEL - REGULAR',
        shippingCountry: 'ID',
        shippingCity: 'Medan',
        shippingAddress: 'Andi Risma, Jl. Gatot Subroto 4, Medan, 20112, ID',
        salesChannel: 'Online Store',
        trackingNumber: null,
      }),
      process: {
        channel: 'biteship',
        channelStep: 'lanjut_pembayaran',
        warehouseStep: 'validasi_awb',
        awbNumber: 'LP4401928',
        assignee: 'Rina',
      },
    },
    {
      order: order({
        id: 'sample-6',
        name: '#AB6519',
        createdAt: ago(10),
        customerName: 'Ningrum Pramatana',
        totalAmount: '451000',
        currency: 'IDR',
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        fulfillBy: ahead(6),
        itemCount: 1,
        itemsJson: items([['Rok plisket', 1]]),
        deliveryMethod: 'Ninja Express - Reguler',
        shippingCountry: 'ID',
        shippingCity: 'Yogyakarta',
        shippingAddress: 'Ningrum Pramatana, Jl. Kaliurang KM 5, Yogyakarta, 55281, ID',
        salesChannel: 'Online Store',
        trackingNumber: 'NX882110045',
      }),
      process: {
        channel: 'biteship',
        channelStep: 'bayar',
        channelDone: 1,
        warehouseStep: 'siap_pickup',
        awbNumber: 'NX882110045',
        awbValidatedAt: readyAt,
        awbValidatedBy: 'Sari',
        assignee: 'Sari',
        readyAt,
      },
    },
    {
      order: order({
        id: 'sample-7',
        name: '#AB9001',
        createdAt: ago(6),
        customerName: 'Lucas Meyer',
        totalAmount: '890000',
        currency: 'IDR',
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        fulfillBy: ahead(40),
        itemCount: 1,
        itemsJson: items([['Jacket wool', 1]]),
        deliveryMethod: 'DHL Express',
        shippingCountry: 'DE',
        shippingCity: 'Berlin',
        shippingAddress: 'Lucas Meyer, Torstrasse 18, Berlin, 10119, DE',
        salesChannel: 'Online Store',
        trackingNumber: null,
      }),
      process: { channel: 'dhl', assignee: 'Dimas' },
    },
    {
      order: order({
        id: 'sample-8',
        name: '#AB6482',
        createdAt: ago(50),
        customerName: 'Marceline van Hery',
        totalAmount: '429000',
        currency: 'IDR',
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        fulfillBy: ago(20),
        itemCount: 5,
        itemsJson: items([
          ['Kemeja oversize', 2],
          ['Celana denim', 2],
          ['Tas kanvas', 1],
        ]),
        deliveryMethod: 'Shipping',
        shippingCountry: 'ID',
        shippingCity: 'Denpasar',
        shippingAddress: 'Marceline van Hery, Jl. Kayu Aya 9, Denpasar, 80361, ID',
        salesChannel: 'Online Store',
        trackingNumber: null,
      }),
      process: {
        channel: 'unassigned',
        problemNote: 'Metode kirim tidak dikenali, pilih channel dulu',
      },
    },
    {
      order: order({
        id: 'sample-9',
        name: '#AB6544',
        createdAt: ago(4),
        customerName: 'Sri Wahyuni',
        totalAmount: '439000',
        currency: 'IDR',
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        fulfillBy: ahead(12),
        itemCount: 2,
        itemsJson: items([
          ['Blus rayon', 1],
          ['Pashmina', 1],
        ]),
        deliveryMethod: 'POS - POS REGULER',
        shippingCountry: 'ID',
        shippingCity: 'Semarang',
        shippingAddress: 'Sri Wahyuni, Jl. Pandanaran 55, Semarang, 50134, ID',
        salesChannel: 'Online Store',
        trackingNumber: null,
      }),
      process: {
        channel: 'indocolite',
        indocoliteMode: 'otomatis',
        channelStep: 'form_pengiriman',
        assignee: 'Sari',
      },
    },
  ]

  for (const row of rows) await saveOrder(row.order, 'sample', row.process)
}
