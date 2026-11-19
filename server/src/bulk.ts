import { biteshipQuote, createBiteshipShipment } from './biteship.js'
import { getJoined, type JoinedRow } from './db.js'
import { createDhlShipment, dhlQuote } from './dhl.js'
import { createIndocoliteShipment, indocoliteQuote } from './indocolite.js'
import { ClientError } from './orders.js'

export interface BulkShipResult {
  id: string
  name: string
  ok: boolean
  awb: string | null
  error: string | null
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

async function one(id: string): Promise<BulkShipResult> {
  const order = await getJoined(id)
  if (!order) return { id, name: id, ok: false, awb: null, error: 'Order tidak ditemukan' }
  try {
    if (order.awb_number) return { id, name: order.name, ok: true, awb: order.awb_number, error: null }
    const awb = await createCheapest(order)
    if (!awb) return { id, name: order.name, ok: false, awb: null, error: 'Resi masih diproses' }
    return { id, name: order.name, ok: true, awb, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Resi gagal dibuat'
    return { id, name: order.name, ok: false, awb: null, error: message }
  }
}

async function createCheapest(order: JoinedRow) {
  if (order.channel === 'indocolite') return indocolite(order.id)
  if (order.channel === 'biteship') return biteship(order.id, order.indocolite_mode === 'manual')
  if (order.channel === 'dhl') return dhl(order.id)
  throw new ClientError('Kurir belum dipilih')
}

async function indocolite(orderId: string) {
  const quote = await indocoliteQuote(orderId)
  const pool = quote.shopifyRates.length > 0 ? quote.shopifyRates : quote.rates
  const rate = cheapest(pool)
  if (!quote.destination || !rate) throw new ClientError('Tarif Indocolite tidak ditemukan')
  const shipment = await createIndocoliteShipment({
    orderId,
    destinationId: quote.destination.id,
    shippingName: rate.shippingName,
    serviceName: rate.serviceName,
    cost: rate.cost,
  })
  return shipment.awb
}

async function biteship(orderId: string, manual: boolean) {
  const quote = await biteshipQuote(orderId)
  const pool = manual || quote.shopifyRates.length === 0 ? quote.rates : quote.shopifyRates
  const rate = cheapest(pool)
  if (!rate) throw new ClientError('Tarif Biteship tidak ditemukan')
  const shipment = await createBiteshipShipment({
    orderId,
    company: rate.company,
    serviceCode: rate.serviceCode,
    cost: rate.cost,
  })
  return shipment.awb
}

async function dhl(orderId: string) {
  const quote = await dhlQuote(orderId)
  const rate = cheapest(quote.rates)
  if (!rate) throw new ClientError('Tarif DHL tidak ditemukan')
  const shipment = await createDhlShipment({ orderId, productCode: rate.productCode, cost: rate.cost })
  return shipment.awb
}

function cheapest<T extends { cost: number }>(rows: T[]) {
  return rows.reduce<T | null>((best, row) => (!best || row.cost < best.cost ? row : best), null)
}
