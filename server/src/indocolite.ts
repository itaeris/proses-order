import { getJoined, getSetting, setSetting, type JoinedRow } from './db.js'
import { ClientError, touch } from './orders.js'
import {
  calculateRates,
  numberEnv,
  pakeet,
  pakeetBalance,
  searchDestinations,
  type PakeetDestination,
  type PakeetRate,
} from './pakeet.js'

const ORIGIN_KEY = 'pakeet_origin'

export interface ShipmentRecord {
  requestId: string | null
  shipmentId: string | null
  awb: string | null
  shippingName: string | null
  serviceName: string | null
  cost: number | null
  status: string
  errorDetail: string | null
}

export interface IndocoliteQuote {
  balance: number
  weightKg: number
  origin: PakeetDestination | null
  originChoices: PakeetDestination[]
  recipient: ReturnType<typeof parseAddress>
  destination: PakeetDestination | null
  destinationChoices: PakeetDestination[]
  rates: PakeetRate[]
  shopifyRates: PakeetRate[]
  shipment: ShipmentRecord | null
  notice: string | null
}

function shipmentKey(orderId: string) {
  return `pakeet_shipment:${orderId}`
}

function parseAddress(address: string | null) {
  const parts = (address ?? '').split(',').map((part) => part.trim()).filter(Boolean)
  let phone = ''
  const last = parts[parts.length - 1] ?? ''
  if (last.replace(/\D/g, '').length >= 9) phone = parts.pop() ?? ''
  if (/^[A-Za-z]{2}$/.test(parts[parts.length - 1] ?? '')) parts.pop()
  let zip = ''
  if (/^\d{5}$/.test(parts[parts.length - 1] ?? '')) zip = parts.pop() ?? ''
  const province = parts.pop() ?? ''
  const city = parts.pop() ?? ''
  const name = parts.shift() ?? ''
  return { name, phone, zip, province, city, street: parts.join(', ') }
}

function sender() {
  const name = process.env.PAKEET_SENDER_NAME?.trim() ?? ''
  const phone = process.env.PAKEET_SENDER_PHONE?.trim() ?? ''
  const address = process.env.PAKEET_SENDER_ADDRESS?.trim() ?? ''
  const city = process.env.PAKEET_SENDER_CITY?.trim() ?? ''
  const province = process.env.PAKEET_SENDER_PROVINCE?.trim() ?? ''
  const postalCode = process.env.PAKEET_SENDER_POSTAL_CODE?.trim() ?? ''
  if (!name || !phone || !address || !city || !province || !postalCode) {
    throw new ClientError('Alamat gudang Pakeet belum lengkap di .env')
  }
  return { name, phone, address, city, province, postalCode }
}

function pickPlace(rows: PakeetDestination[], address: string) {
  if (rows.length === 0) return null
  const hay = address.toLowerCase()
  return [...rows].sort((a, b) => score(b, hay) - score(a, hay) || a.id - b.id)[0]
}

function score(row: PakeetDestination, hay: string) {
  const name = row.subdistrict_name.toLowerCase().trim()
  if (name.length < 4 || !hay.includes(name)) return 0
  return name.length
}

async function savedOrigin(choices: PakeetDestination[]) {
  const raw = (await getSetting(ORIGIN_KEY)) || process.env.PAKEET_ORIGIN_ID?.trim() || ''
  const id = Number(raw)
  if (!id) return null
  return choices.find((row) => row.id === id) ?? null
}

async function loadShipment(orderId: string): Promise<ShipmentRecord | null> {
  const raw = await getSetting(shipmentKey(orderId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as ShipmentRecord
  } catch {
    return null
  }
}

async function saveShipment(orderId: string, record: ShipmentRecord) {
  await setSetting(shipmentKey(orderId), JSON.stringify(record))
}

function numericOrderId(gid: string) {
  const match = gid.match(/(\d+)$/)
  return match?.[1] ?? gid
}

function shopifyNumber(name: string) {
  return name.startsWith('#') ? name : `#${name}`
}

export async function indocoliteQuote(orderId: string, destinationId?: number): Promise<IndocoliteQuote> {
  const order = await requireIndocolite(orderId)
  const recipient = parseAddress(order.shipping_address)
  const weightKg = numberEnv('PAKEET_DEFAULT_WEIGHT_KG', 1)
  const [balance, originChoices, destinationChoices, shipment] = await Promise.all([
    pakeetBalance(),
    searchDestinations(sender().postalCode),
    searchDestinations(recipient.zip || recipient.city),
    loadShipment(orderId),
  ])
  let origin = await savedOrigin(originChoices)
  if (!origin && originChoices.length > 0) {
    const from = sender()
    origin = pickPlace(originChoices, `${from.address}, ${from.city}`)
    if (origin) await setSetting(ORIGIN_KEY, String(origin.id))
  }
  const destination = destinationChoices.find((row) => row.id === destinationId) ?? pickPlace(destinationChoices, order.shipping_address ?? '')
  let rates: PakeetRate[] = []
  let shopifyRates: PakeetRate[] = []
  let notice: string | null = null
  if (!origin) notice = 'Kelurahan gudang tidak ditemukan dari kode pos gudang.'
  else if (!destination) notice = 'Kelurahan penerima tidak ditemukan dari alamat Shopify.'
  else {
    rates = await calculateRates({
      originId: origin.id,
      destinationId: destination.id,
      weightGrams: Math.round(weightKg * 1000),
      itemValue: Math.round(Number(order.total_amount ?? 0)) || 0,
    })
    const method = order.delivery_method ?? ''
    shopifyRates = rates.filter((rate) => matchesShopifyMethod(method, rate.shippingName))
    if (method && rates.length > 0 && shopifyRates.length === 0) {
      notice = `Shopify sudah memilih ${method}. Tarif kurir itu tidak ada di Pakeet, jadi dipakai yang termurah.`
    }
  }
  return {
    balance,
    weightKg,
    origin,
    originChoices,
    recipient,
    destination,
    destinationChoices,
    rates,
    shopifyRates,
    shipment,
    notice,
  }
}

export async function saveOrigin(originId: number) {
  const choices = await searchDestinations(sender().postalCode)
  const match = choices.find((row) => row.id === originId)
  if (!match) throw new ClientError('Kelurahan gudang tidak ditemukan')
  await setSetting(ORIGIN_KEY, String(match.id))
  return match
}

export async function createIndocoliteShipment(input: {
  orderId: string
  destinationId: number
  shippingName: string
  serviceName: string
  cost: number
}) {
  const order = await requireIndocolite(input.orderId)
  const existing = await loadShipment(input.orderId)
  if (existing?.awb || existing?.status === 'completed' || existing?.status === 'queued' || existing?.status === 'processing') {
    throw new ClientError('Pengiriman untuk order ini sudah dibuat')
  }
  const quote = await indocoliteQuote(input.orderId, input.destinationId)
  const origin = quote.origin
  const destination = quote.destination
  if (!origin || !destination) throw new ClientError('Kelurahan asal dan tujuan wajib dipilih')
  const rate = quote.rates.find((row) => row.shippingName === input.shippingName && row.serviceName === input.serviceName)
  if (!rate || Math.round(rate.cost) !== Math.round(input.cost)) {
    throw new ClientError('Ongkir itu sudah tidak berlaku. Muat ulang daftarnya.')
  }
  const shopifyHasRate = quote.shopifyRates.length > 0
  if (shopifyHasRate && order.delivery_method && order.indocolite_mode !== 'manual' && !matchesShopifyMethod(order.delivery_method, rate.shippingName)) {
    throw new ClientError('Kurir ini bukan pilihan Shopify. Ganti kurir hanya lewat Manual.')
  }
  const from = sender()
  const to = quote.recipient
  if (!to.phone || !to.street) throw new ClientError('Telepon atau alamat penerima tidak lengkap')
  const weightKg = quote.weightKg
  const items = JSON.parse(order.items_json) as Array<{ name?: string }>
  const lines = items.length > 0 ? items : [{ name: 'Paket' }]
  const each = Math.max(0.1, Math.round((weightKg / lines.length) * 100) / 100)
  const value = Math.round(Number(order.total_amount ?? 0)) || 0
  const shopifyId = numericOrderId(order.id)
  const response = await pakeet('/api/v1/shipments', {
    method: 'POST',
    headers: { 'Idempotency-Key': `shopify:${process.env.SHOPIFY_SHOP}:${shopifyId}` },
    body: JSON.stringify({
      sender_address_id: origin.id,
      recipient_address_id: destination.id,
      sender_name: from.name,
      sender_business_name: from.name,
      sender_phone: from.phone,
      sender_address: from.address,
      sender_city: from.city,
      sender_province: from.province,
      sender_postal_code: from.postalCode,
      recipient_name: to.name || order.customer_name || 'Penerima',
      recipient_phone: to.phone,
      recipient_address: to.street,
      recipient_city: to.city || destination.city_name,
      recipient_province: to.province || destination.province_name,
      recipient_postal_code: to.zip || destination.zip_code,
      courier_id: input.shippingName.toLowerCase(),
      service_code: input.serviceName,
      service_name: input.serviceName,
      selected_shipping_cost: rate.cost,
      payment_method: 'BANK TRANSFER',
      is_insurance: false,
      length: numberEnv('PAKEET_PACKAGE_LENGTH', 20),
      width: numberEnv('PAKEET_PACKAGE_WIDTH', 15),
      height: numberEnv('PAKEET_PACKAGE_HEIGHT', 10),
      items: lines.map((item, index) => ({
        description: item.name || 'Paket',
        weight: each,
        item_value: index === 0 ? value : 0,
      })),
      integration_source: 'shopify',
      integration_order_id: shopifyId,
      shopify_store_id: process.env.SHOPIFY_SHOP,
      shopify_order_id: shopifyId,
      shopify_order_number: shopifyNumber(order.name),
    }),
  })
  const queued = response.data as { request_id?: string } | undefined
  const requestId = queued?.request_id
  if (!requestId) throw new ClientError('Pakeet tidak mengembalikan nomor permintaan')
  let record: ShipmentRecord = {
    requestId,
    shipmentId: null,
    awb: null,
    shippingName: input.shippingName,
    serviceName: input.serviceName,
    cost: rate.cost,
    status: 'queued',
    errorDetail: null,
  }
  await saveShipment(input.orderId, record)
  return settle(input.orderId, record)
}

async function settle(orderId: string, record: ShipmentRecord): Promise<ShipmentRecord> {
  if (!record.requestId) return record
  let latest = record
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const body = await pakeet(`/api/v1/shipment-creation-requests/${record.requestId}`)
    const data = body.data as {
      status?: string
      message?: string
      error_detail?: string | null
      shipment?: { id?: string }
    }
    const status = data.status ?? 'processing'
    if (status === 'failed') {
      const reason = data.error_detail || data.message || 'Pakeet gagal membuat resi'
      latest = { ...record, status: 'failed', errorDetail: reason }
      await saveShipment(orderId, latest)
      throw new ClientError(reason)
    }
    if (status === 'unknown') {
      latest = { ...record, status: 'unknown' }
      await saveShipment(orderId, latest)
      throw new ClientError('Status Pakeet tidak diketahui. Jangan buat resi baru sebelum dicek ke Pakeet.')
    }
    if (status === 'completed' && data.shipment?.id) {
      const label = await pakeet(`/api/v1/shipments/${data.shipment.id}/label`)
      const awb = (label.data as { awb_number?: string } | undefined)?.awb_number ?? null
      latest = { ...record, status: 'completed', shipmentId: data.shipment.id, awb }
      await saveShipment(orderId, latest)
      await touch(orderId, {
        indocolite_mode: 'otomatis',
        channel_step: 'konfirmasi',
        channel_done: 0,
        ...(awb ? { awb_number: awb } : {}),
      })
      return latest
    }
    await delay(1500)
  }
  await touch(orderId, { indocolite_mode: 'otomatis', channel_step: 'form_pengiriman' })
  return latest
}

export async function refreshIndocoliteShipment(orderId: string) {
  await requireIndocolite(orderId)
  const record = await loadShipment(orderId)
  if (!record?.requestId) throw new ClientError('Order ini belum punya permintaan resi')
  if (record.awb) return record
  try {
    return await settle(orderId, record)
  } catch (error) {
    const saved = await loadShipment(orderId)
    if (saved?.status === 'failed') return saved
    throw error
  }
}

export async function requestIndocolitePickup(input: { orderId: string; date: string; time: string; vehicle: string }) {
  const order = await requireIndocolite(input.orderId)
  const record = await loadShipment(input.orderId)
  if (!record?.shipmentId) throw new ClientError('Resi belum selesai dibuat')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ClientError('Tanggal pickup tidak valid')
  if (!/^\d{2}:\d{2}$/.test(input.time)) throw new ClientError('Jam pickup tidak valid')
  if (!['Motor', 'Mobil', 'Truk'].includes(input.vehicle)) throw new ClientError('Kendaraan pickup tidak valid')
  await pakeet(`/api/v1/shipments/${record.shipmentId}/pickup`, {
    method: 'POST',
    body: JSON.stringify({
      pickup_date: input.date,
      pickup_time: input.time,
      pickup_vehicle: input.vehicle,
    }),
  })
  await touch(order.id, { channel_step: 'konfirmasi', channel_done: 1 })
  return record
}

async function requireIndocolite(orderId: string): Promise<JoinedRow> {
  const order = await getJoined(decodeURIComponent(orderId))
  if (!order) throw new ClientError('Order tidak ditemukan')
  if (order.channel !== 'indocolite') throw new ClientError('Buat resi Pakeet hanya untuk channel Indocolite')
  return order
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const COURIER_KEYS: Record<string, string[]> = {
  jnt: ['j&t', 'jnt'],
  jne: ['jne'],
  sicepat: ['sicepat', 'si cepat'],
  pos: ['pos'],
  lion: ['lion'],
  ninja: ['ninja'],
  anteraja: ['anteraja'],
  sap: ['sap'],
  idexpress: ['idexpress', 'id express'],
  tiki: ['tiki'],
  wahana: ['wahana'],
}

function matchesShopifyMethod(method: string, shippingName: string) {
  const hay = method.toLowerCase()
  const name = shippingName.toLowerCase().replace(/\s+/g, '')
  const keys = COURIER_KEYS[name] ?? [shippingName.toLowerCase()]
  return keys.some((key) => key.length > 1 && hay.includes(key))
}
