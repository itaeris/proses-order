import { biteshipQuote, createBiteshipShipment } from './biteship.js'
import { getJoined, type JoinedRow } from './db.js'
import { createDhlShipment, dhlQuote } from './dhl.js'
import { createIndocoliteShipment, indocoliteQuote } from './indocolite.js'
import { ClientError } from './orders.js'

export type BulkChannel = 'indocolite' | 'biteship' | 'dhl' | 'unassigned'
export type BulkStatus = 'created' | 'processing' | 'failed'

export interface BulkShipResult {
  id: string
  name: string
  channel: BulkChannel
  status: BulkStatus
  awb: string | null
  courier: string | null
  detail: string
}

export async function shipOrders(ids: unknown): Promise<BulkShipResult[]> {
  if (!Array.isArray(ids) || ids.length === 0) throw new ClientError('Pilih order dulu')
  const unique = [...new Set(ids.map((id) => String(id)))].filter(Boolean)
  if (unique.length > 25) throw new ClientError('Pilih paling banyak 25 order sekaligus')
  const results: BulkShipResult[] = []
  for (const id of unique) {
    results.push(await one(id))
  }
  return results
}

function channelOf(order: JoinedRow): BulkChannel {
  if (order.channel === 'indocolite' || order.channel === 'biteship' || order.channel === 'dhl') return order.channel
  return 'unassigned'
}

function result(
  order: JoinedRow,
  status: BulkStatus,
  detail: string,
  extra: { awb?: string | null; courier?: string | null } = {},
): BulkShipResult {
  return {
    id: order.id,
    name: order.name,
    channel: channelOf(order),
    status,
    awb: extra.awb ?? null,
    courier: extra.courier ?? null,
    detail,
  }
}

async function one(id: string): Promise<BulkShipResult> {
  const order = await getJoined(id)
  if (!order) {
    return { id, name: id, channel: 'unassigned', status: 'failed', awb: null, courier: null, detail: 'Order tidak ditemukan' }
  }
  try {
    if (!order.assignee) return result(order, 'failed', 'Tekan Proses di halaman order dulu.')
    if (order.awb_number) return result(order, 'created', 'Resi sudah ada, tidak dibuat ulang.', { awb: order.awb_number })
    return await createCheapest(order)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Resi gagal dibuat'
    return result(order, 'failed', message)
  }
}

async function createCheapest(order: JoinedRow) {
  if (order.channel === 'indocolite') return indocolite(order)
  if (order.channel === 'biteship') return biteship(order)
  if (order.channel === 'dhl') return dhl(order)
  return result(order, 'failed', 'Kurir belum dipilih. Pilih Indocolite, Biteship, atau DHL di halaman order.')
}

async function indocolite(order: JoinedRow) {
  const quote = await indocoliteQuote(order.id)
  const pool = quote.shopifyRates.length > 0 ? quote.shopifyRates : quote.rates
  const rate = cheapest(pool)
  if (!quote.destination || !rate) throw new ClientError('Tarif Indocolite tidak ditemukan')
  const shipment = await createIndocoliteShipment({
    orderId: order.id,
    destinationId: quote.destination.id,
    shippingName: rate.shippingName,
    serviceName: rate.serviceName,
    cost: rate.cost,
  })
  const courier = shipment.shippingName
  if (!shipment.awb) {
    return result(order, 'processing', 'Permintaan sudah masuk. Nomor resi belum keluar.', { courier })
  }
  return result(order, 'created', 'Resi jadi.', { awb: shipment.awb, courier })
}

async function biteship(order: JoinedRow) {
  const quote = await biteshipQuote(order.id)
  const pool = quote.shopifyRates.length === 0 ? quote.rates : quote.shopifyRates
  const rate = cheapest(pool)
  if (!rate) throw new ClientError('Tarif Biteship tidak ditemukan')
  const shipment = await createBiteshipShipment({
    orderId: order.id,
    company: rate.company,
    serviceCode: rate.serviceCode,
    cost: rate.cost,
  })
  const courier = shipment.shippingName
  if (!shipment.awb) return result(order, 'processing', 'Kiriman sudah dibuat. Nomor resi belum keluar.', { courier })
  return result(order, 'created', 'Resi jadi. Saldo Biteship sudah terpotong.', { awb: shipment.awb, courier })
}

async function dhl(order: JoinedRow) {
  const quote = await dhlQuote(order.id)
  const rate = cheapest(quote.rates)
  if (!rate) throw new ClientError('Tarif DHL tidak ditemukan')
  const shipment = await createDhlShipment({ orderId: order.id, productCode: rate.productCode, cost: rate.cost })
  if (!shipment.awb) return result(order, 'processing', 'Kiriman sudah dibuat di DHL. Nomor resi belum keluar.', { courier: 'DHL' })
  return result(order, 'created', 'Resi jadi. Label PDF ada di halaman order.', { awb: shipment.awb, courier: shipment.shippingName || 'DHL' })
}

function cheapest<T extends { cost: number }>(rows: T[]) {
  return rows.reduce<T | null>((best, row) => (!best || row.cost < best.cost ? row : best), null)
}
