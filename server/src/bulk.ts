import { biteshipQuote, createBiteshipShipment, refreshBiteshipShipment } from './biteship.js'
import { getJoined, getSetting, type JoinedRow } from './db.js'
import { createDhlShipment, dhlQuote, refreshDhlShipment } from './dhl.js'
import { createIndocoliteShipment, indocoliteQuote, refreshIndocoliteShipment, requestIndocolitePickup, type ShipmentRecord } from './indocolite.js'
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
  service: string | null
  cost: number | null
  pickup: string | null
  detail: string
}

export async function shipOrders(ids: unknown): Promise<BulkShipResult[]> {
  const unique = orderIds(ids)
  const results: BulkShipResult[] = []
  for (const id of unique) results.push(await one(id))
  return results
}

export async function refreshOrders(ids: unknown): Promise<BulkShipResult[]> {
  const unique = orderIds(ids)
  const results: BulkShipResult[] = []
  for (const id of unique) results.push(await refreshOne(id))
  return results
}

export async function recallOrders(ids: unknown): Promise<BulkShipResult[]> {
  const unique = orderIds(ids)
  const results: BulkShipResult[] = []
  for (const id of unique) results.push(await recallOne(id))
  return results
}

export async function pickupOrders(ids: unknown, input: { date: string; time: string; vehicle: string }): Promise<BulkShipResult[]> {
  const unique = orderIds(ids)
  const results: BulkShipResult[] = []
  for (const id of unique) results.push(await pickupOne(id, input))
  return results
}

function orderIds(ids: unknown) {
  if (!Array.isArray(ids) || ids.length === 0) throw new ClientError('Pilih order dulu')
  const unique = [...new Set(ids.map((id) => String(id)))].filter(Boolean)
  if (unique.length > 25) throw new ClientError('Pilih paling banyak 25 order sekaligus')
  return unique
}

function channelOf(order: JoinedRow): BulkChannel {
  if (order.channel === 'indocolite' || order.channel === 'biteship' || order.channel === 'dhl') return order.channel
  return 'unassigned'
}

function result(
  order: JoinedRow,
  status: BulkStatus,
  detail: string,
  extra: { awb?: string | null; courier?: string | null; service?: string | null; cost?: number | null; pickup?: string | null } = {},
): BulkShipResult {
  return {
    id: order.id,
    name: order.name,
    channel: channelOf(order),
    status,
    awb: extra.awb ?? null,
    courier: extra.courier ?? null,
    service: extra.service ?? null,
    cost: extra.cost ?? null,
    pickup: extra.pickup ?? null,
    detail,
  }
}

async function one(id: string): Promise<BulkShipResult> {
  const order = await getJoined(id)
  if (!order) {
    return { id, name: id, channel: 'unassigned', status: 'failed', awb: null, courier: null, service: null, cost: null, pickup: null, detail: 'Order tidak ditemukan' }
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
  const booked = {
    courier: shipment.shippingName || rate.shippingName,
    service: shipment.serviceName || rate.serviceName,
    cost: shipment.cost ?? rate.cost,
  }
  return describeIndocolite(order, shipment, booked)
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
  const booked = {
    courier: shipment.shippingName || rate.shippingName,
    service: shipment.serviceName || rate.serviceName,
    cost: shipment.cost ?? rate.cost,
  }
  if (!shipment.awb) return result(order, 'processing', 'Kiriman sudah dibuat. Nomor resi belum keluar. Tekan Cek status.', booked)
  return result(order, 'created', 'Resi jadi dan saldo sudah terpotong.', { awb: shipment.awb, ...booked })
}

async function dhl(order: JoinedRow) {
  const quote = await dhlQuote(order.id)
  const rate = cheapest(quote.rates)
  if (!rate) throw new ClientError('Tarif DHL tidak ditemukan')
  const shipment = await createDhlShipment({ orderId: order.id, productCode: rate.productCode, cost: rate.cost })
  const booked = { courier: shipment.shippingName || 'DHL', service: shipment.serviceName || rate.serviceName, cost: shipment.cost ?? rate.cost }
  if (!shipment.awb) return result(order, 'processing', 'Kiriman sudah dibuat di DHL. Nomor resi belum keluar. Tekan Cek status.', booked)
  return result(order, 'created', 'Resi jadi. Label PDF ada di halaman order.', { awb: shipment.awb, ...booked })
}

async function refreshOne(id: string): Promise<BulkShipResult> {
  const order = await getJoined(id)
  if (!order) {
    return { id, name: id, channel: 'unassigned', status: 'failed', awb: null, courier: null, service: null, cost: null, pickup: null, detail: 'Order tidak ditemukan' }
  }
  try {
    if (order.channel === 'indocolite') {
      const shipment = await refreshIndocoliteShipment(order.id)
      return describeIndocolite(order, shipment, undefined, true)
    }
    if (order.channel === 'biteship') {
      const shipment = await refreshBiteshipShipment(order.id)
      const booked = { courier: shipment.shippingName, service: shipment.serviceName, cost: shipment.cost }
      if (!shipment.awb) return result(order, 'processing', 'Nomor resi belum keluar.', booked)
      return result(order, 'created', 'Resi jadi.', { awb: shipment.awb, ...booked })
    }
    if (order.channel === 'dhl') {
      const shipment = await refreshDhlShipment(order.id)
      const booked = { courier: shipment.shippingName || 'DHL', service: shipment.serviceName, cost: shipment.cost }
      if (!shipment.awb) return result(order, 'processing', 'Nomor resi belum keluar.', booked)
      return result(order, 'created', shipment.status ? `Status DHL: ${shipment.status}` : 'Resi jadi.', { awb: shipment.awb, ...booked })
    }
    return result(order, 'failed', 'Kurir belum dipilih.')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Status resi gagal dicek'
    return result(order, 'failed', message)
  }
}

async function pickupOne(id: string, input: { date: string; time: string; vehicle: string }): Promise<BulkShipResult> {
  const order = await getJoined(id)
  if (!order) {
    return { id, name: id, channel: 'unassigned', status: 'failed', awb: null, courier: null, service: null, cost: null, pickup: null, detail: 'Order tidak ditemukan' }
  }
  try {
    if (order.channel !== 'indocolite') return result(order, 'failed', 'Ajukan pickup masal dipakai untuk Indocolite.')
    await requestIndocolitePickup({ orderId: order.id, date: input.date, time: input.time, vehicle: input.vehicle })
    const shipment = await refreshIndocoliteShipment(order.id)
    return describeIndocolite(order, shipment, undefined, true)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pickup gagal diajukan'
    const status = /belum selesai|belum keluar/i.test(message) ? 'processing' : 'failed'
    return result(order, status, message, { awb: order.awb_number })
  }
}

function describeIndocolite(
  order: JoinedRow,
  shipment: ShipmentRecord,
  booked: { courier: string | null; service: string | null; cost: number | null } = {
    courier: shipment.shippingName,
    service: shipment.serviceName,
    cost: shipment.cost,
  },
  checked = false,
) {
  const extra = { ...booked, pickup: pickupLabel(shipment) }
  if (shipment.status === 'failed') {
    return result(order, 'failed', shipment.errorDetail || 'Pakeet gagal membuat resi', extra)
  }
  if (!shipment.awb && !shipment.pickupDate) {
    return result(order, 'processing', 'Permintaan masuk dan saldo sudah terpotong. Ajukan pickup dulu. Nomor resi keluar setelah pickup.', extra)
  }
  if (!shipment.awb) {
    const detail = checked
      ? `Dicek ${clock()}. Pickup sudah diajukan, nomor resi belum keluar.`
      : 'Pickup diajukan. Tekan Cek status sampai nomor resi tampil.'
    return result(order, 'processing', detail, extra)
  }
  if (shipment.pickupDate) {
    return result(order, 'created', 'Resi jadi. Pickup sudah diajukan.', { awb: shipment.awb, ...extra })
  }
  return result(order, 'created', 'Resi jadi.', { awb: shipment.awb, ...extra })
}

function clock() {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date())
}

function pickupLabel(shipment: { pickupDate?: string | null; pickupTime?: string | null; pickupVehicle?: string | null }) {
  if (!shipment.pickupDate) return null
  const [year, month, day] = shipment.pickupDate.split('-')
  const shown = year && month && day ? `${day}/${month}/${year}` : shipment.pickupDate
  return `Pickup ${shown} pukul ${shipment.pickupTime ?? ''}, ${shipment.pickupVehicle ?? ''}.`.replace(/\s+,/g, ',')
}

async function recallOne(id: string): Promise<BulkShipResult> {
  const order = await getJoined(id)
  if (!order) {
    return { id, name: id, channel: 'unassigned', status: 'failed', awb: null, courier: null, service: null, cost: null, pickup: null, detail: 'Order tidak ditemukan' }
  }
  const key = shipmentSettingKey(order)
  const raw = key ? await getSetting(key) : null
  if (!raw) {
    if (order.awb_number) return result(order, 'created', 'Resi sudah ada.', { awb: order.awb_number })
    return result(order, 'failed', 'Belum ada kiriman.')
  }
  try {
    if (order.channel === 'indocolite') return describeIndocolite(order, JSON.parse(raw) as ShipmentRecord)
    const shipment = JSON.parse(raw) as { awb?: string | null; shippingName?: string | null; serviceName?: string | null; cost?: number | null; status?: string; errorDetail?: string | null }
    const booked = { courier: shipment.shippingName ?? null, service: shipment.serviceName ?? null, cost: shipment.cost ?? null }
    if (shipment.status === 'failed') return result(order, 'failed', shipment.errorDetail || 'Resi gagal dibuat', booked)
    if (!shipment.awb) return result(order, 'processing', 'Kiriman sudah dibuat. Nomor resi belum keluar.', booked)
    return result(order, 'created', 'Resi jadi.', { awb: shipment.awb, ...booked })
  } catch {
    return result(order, 'failed', 'Riwayat kiriman tidak terbaca.')
  }
}

function shipmentSettingKey(order: JoinedRow) {
  if (order.channel === 'indocolite') return `pakeet_shipment:${order.id}`
  if (order.channel === 'biteship') return `biteship_shipment:${order.id}`
  if (order.channel === 'dhl') return `dhl_shipment:${order.id}`
  return ''
}

function cheapest<T extends { cost: number }>(rows: T[]) {
  return rows.reduce<T | null>((best, row) => (!best || row.cost < best.cost ? row : best), null)
}
