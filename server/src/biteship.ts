import { dropCache, remember as cached } from './cache.js'
import { getJoined, getSetting, setSetting, type JoinedRow } from './db.js'
import { ClientError, touch } from './orders.js'

const COURIERS = 'jne,sicepat,jnt,ninja,lion,anteraja,pos,sap,ide,tiki'

export interface BiteshipRate {
  company: string
  shippingName: string
  serviceName: string
  serviceCode: string
  cost: number
  etd: string
}

export interface BiteshipShipment {
  orderId: string | null
  awb: string | null
  shippingName: string | null
  serviceName: string | null
  cost: number | null
  status: string
  errorDetail: string | null
}

export interface BiteshipQuote {
  balance: number | null
  weightKg: number
  originPostalCode: string
  destinationPostalCode: string
  rates: BiteshipRate[]
  shopifyRates: BiteshipRate[]
  shipment: BiteshipShipment | null
  notice: string | null
}

interface BiteshipBody {
  success?: boolean
  error?: string
  code?: number
  details?: { order_id?: string; waybill_id?: string }
  pricing?: unknown
  id?: string
  price?: number
  status?: string
  wallet?: { balance?: number }
  courier?: { company?: string; type?: string; waybill_id?: string | null; name?: string | null }
}

function base() {
  return (process.env.BITESHIP_API_BASE?.trim() || 'https://api.biteship.com').replace(/\/$/, '')
}

function key() {
  const value = process.env.BITESHIP_API_KEY?.trim()
  if (!value) throw new ClientError('BITESHIP_API_KEY belum diisi')
  return value
}

async function call(path: string, init?: RequestInit): Promise<BiteshipBody> {
  const token = key()
  let response: Response
  try {
    response = await fetch(`${base()}${path}`, {
      ...init,
      headers: {
        Authorization: token,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    if (error instanceof ClientError) throw error
    const reason = error instanceof Error ? error.message : 'gagal terhubung'
    throw new ClientError(`Biteship tidak terjangkau (${reason})`)
  }
  const body = (await response.json().catch(() => ({}))) as BiteshipBody
  if (response.ok && body.success !== false) return body
  const duplicate = body.code === 40002060 && body.details?.order_id
  if (duplicate) return body
  throw new ClientError(body.error || `Biteship menolak permintaan (${response.status})`)
}

function shipmentKey(orderId: string) {
  return `biteship_shipment:${orderId}`
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
  return { name, phone: localPhone(phone), zip, province, city, street: parts.join(', ') }
}

function localPhone(value: string) {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('62')) digits = `0${digits.slice(2)}`
  if (digits && !digits.startsWith('0')) digits = `0${digits}`
  return digits
}

function sender() {
  const name = process.env.PAKEET_SENDER_NAME?.trim() ?? ''
  const phone = localPhone(process.env.PAKEET_SENDER_PHONE?.trim() ?? '')
  const address = process.env.PAKEET_SENDER_ADDRESS?.trim() ?? ''
  const postalCode = process.env.PAKEET_SENDER_POSTAL_CODE?.trim() ?? ''
  if (!name || !phone || !address || !/^\d{5}$/.test(postalCode)) {
    throw new ClientError('Alamat gudang belum lengkap di .env')
  }
  return { name, phone, address, postalCode }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function weightKg() {
  return numberEnv('PAKEET_DEFAULT_WEIGHT_KG', 1)
}

async function loadShipment(orderId: string): Promise<BiteshipShipment | null> {
  const raw = await getSetting(shipmentKey(orderId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as BiteshipShipment
  } catch {
    return null
  }
}

async function saveShipment(orderId: string, record: BiteshipShipment) {
  await setSetting(shipmentKey(orderId), JSON.stringify(record))
}

export async function biteshipBalance(): Promise<number | null> {
  try {
    const body = await call('/v1/wallets')
    const balance = Number(body.wallet?.balance)
    return Number.isFinite(balance) ? balance : null
  } catch {
    return null
  }
}

function readRates(body: BiteshipBody): BiteshipRate[] {
  if (!Array.isArray(body.pricing)) return []
  const rates: BiteshipRate[] = []
  for (const row of body.pricing) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const company = String(item.courier_code ?? item.company ?? '').toLowerCase()
    const cost = Number(item.price)
    if (!company || !Number.isFinite(cost)) continue
    rates.push({
      company,
      shippingName: String(item.courier_name ?? company).toUpperCase(),
      serviceName: String(item.courier_service_name ?? item.type ?? ''),
      serviceCode: String(item.courier_service_code ?? item.type ?? ''),
      cost,
      etd: String(item.duration ?? ''),
    })
  }
  return rates.sort((a, b) => a.cost - b.cost)
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
  ide: ['idexpress', 'id express'],
  tiki: ['tiki'],
}

function matchesCourier(method: string, company: string) {
  const hay = method.toLowerCase()
  const keys = COURIER_KEYS[company] ?? [company]
  return keys.some((key) => key.length > 1 && hay.includes(key))
}

function matchingRates(method: string | null, rates: BiteshipRate[]) {
  if (!method) return []
  const matched = rates.filter((rate) => matchesCourier(method, rate.company))
  if (matched.length <= 1) return matched
  const hay = method.toLowerCase()
  const tighter = matched.filter((rate) => {
    const service = rate.serviceName.toLowerCase()
    const code = rate.serviceCode.toLowerCase()
    return (service.length > 2 && hay.includes(service)) || (code.length > 2 && hay.includes(code))
  })
  return tighter.length > 0 ? tighter : matched
}

export async function biteshipQuote(orderId: string): Promise<BiteshipQuote> {
  const order = await requireBiteship(orderId)
  const from = sender()
  const to = parseAddress(order.shipping_address)
  if (!/^\d{5}$/.test(to.zip)) throw new ClientError('Kode pos penerima tidak terbaca dari alamat Shopify')
  const kg = weightKg()
  const rateKey = `biteship:rates:${from.postalCode}:${to.zip}:${kg}:${Math.round(Number(order.total_amount ?? 0))}`
  const [body, balance] = await Promise.all([
    cached(rateKey, 45_000, () =>
      call('/v1/rates/couriers', {
        method: 'POST',
        body: JSON.stringify({
          origin_postal_code: Number(from.postalCode),
          destination_postal_code: Number(to.zip),
          couriers: COURIERS,
          items: [parcel(order, kg)],
        }),
      }),
    ),
    cached('biteship:balance', 10_000, () => biteshipBalance()),
  ])
  const rates = readRates(body)
  const shopifyRates = matchingRates(order.delivery_method, rates)
  const shipment = await loadShipment(order.id)
  let notice: string | null = null
  if (order.delivery_method && shopifyRates.length === 0) {
    notice = `Shopify sudah memilih ${order.delivery_method}. Tarif kurir itu tidak ada di Biteship, jadi dipakai yang termurah.`
  }
  return {
    balance,
    weightKg: kg,
    originPostalCode: from.postalCode,
    destinationPostalCode: to.zip,
    rates,
    shopifyRates,
    shipment,
    notice,
  }
}

export async function createBiteshipShipment(input: {
  orderId: string
  company: string
  serviceCode: string
  cost: number
}) {
  const order = await requireBiteship(input.orderId)
  if (!order.assignee) throw new ClientError('Tekan Proses dulu')
  const existing = await loadShipment(order.id)
  if (existing?.awb || (existing?.orderId && existing.status !== 'cancelled' && existing.status !== 'rejected')) {
    throw new ClientError('Pengiriman untuk order ini sudah dibuat')
  }
  const quote = await biteshipQuote(order.id)
  const rate = quote.rates.find((row) => row.company === input.company && row.serviceCode === input.serviceCode)
  if (!rate || Math.round(rate.cost) !== Math.round(input.cost)) {
    throw new ClientError('Ongkir itu sudah tidak berlaku. Muat ulang daftarnya.')
  }
  const allowed = quote.shopifyRates.length > 0 ? quote.shopifyRates : quote.rates
  if (!allowed.some((row) => row.company === rate.company && row.serviceCode === rate.serviceCode)) {
    throw new ClientError('Kurir ini bukan pilihan Shopify.')
  }
  const from = sender()
  const to = parseAddress(order.shipping_address)
  if (!to.phone || !to.street) throw new ClientError('Telepon atau alamat penerima tidak lengkap')
  const reference = `shopify:${process.env.SHOPIFY_SHOP}:${numericOrderId(order.id)}`
  const body = await call('/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      reference_id: reference,
      shipper_contact_name: from.name,
      shipper_contact_phone: from.phone,
      shipper_organization: from.name,
      origin_contact_name: from.name,
      origin_contact_phone: from.phone,
      origin_address: from.address,
      origin_postal_code: Number(from.postalCode),
      destination_contact_name: to.name || order.customer_name || 'Penerima',
      destination_contact_phone: to.phone,
      destination_address: to.street,
      destination_postal_code: Number(to.zip),
      courier_company: rate.company,
      courier_type: rate.serviceCode,
      delivery_type: 'now',
      order_note: order.name,
      metadata: { shopify_order: order.name },
      items: [parcel(order, quote.weightKg)],
    }),
  })
  dropCache('biteship:balance')
  const biteshipId = body.id || body.details?.order_id || null
  if (!biteshipId) throw new ClientError('Biteship tidak mengembalikan nomor order')
  const created = body.id ? body : await call(`/v1/orders/${biteshipId}`)
  return remember(order, created, rate)
}

export async function refreshBiteshipShipment(orderId: string) {
  const order = await requireBiteship(orderId)
  const record = await loadShipment(order.id)
  if (!record?.orderId) throw new ClientError('Order ini belum punya resi Biteship')
  const body = await call(`/v1/orders/${record.orderId}`)
  return remember(order, body, {
    company: record.shippingName ?? '',
    shippingName: record.shippingName ?? '',
    serviceName: record.serviceName ?? '',
    serviceCode: '',
    cost: record.cost ?? Number(body.price ?? 0),
    etd: '',
  })
}

async function remember(order: JoinedRow, body: BiteshipBody, rate: BiteshipRate): Promise<BiteshipShipment> {
  const awb = body.courier?.waybill_id?.trim() || null
  const record: BiteshipShipment = {
    orderId: body.id ?? null,
    awb,
    shippingName: body.courier?.company?.toUpperCase() || rate.shippingName || null,
    serviceName: body.courier?.type || rate.serviceName || null,
    cost: Number.isFinite(Number(body.price)) ? Number(body.price) : rate.cost,
    status: body.status || 'confirmed',
    errorDetail: null,
  }
  await saveShipment(order.id, record)
  if (awb) {
    await touch(order.id, {
      channel_step: 'bayar',
      channel_done: 1,
      ...(order.awb_validated_at ? {} : { awb_number: awb }),
    })
  }
  return record
}

function parcel(order: JoinedRow, kg: number) {
  const value = Math.round(Number(order.total_amount ?? 0))
  const items = JSON.parse(order.items_json) as Array<{ name?: string }>
  const description = items.map((item) => item.name).filter(Boolean).join(', ').slice(0, 240) || 'Paket'
  return {
    name: order.name,
    description,
    category: 'beauty',
    value: value > 0 ? value : 1000,
    quantity: 1,
    weight: Math.max(1, Math.round(kg * 1000)),
    length: numberEnv('PAKEET_PACKAGE_LENGTH', 20),
    width: numberEnv('PAKEET_PACKAGE_WIDTH', 15),
    height: numberEnv('PAKEET_PACKAGE_HEIGHT', 10),
  }
}

async function requireBiteship(orderId: string): Promise<JoinedRow> {
  const order = await getJoined(decodeURIComponent(orderId))
  if (!order) throw new ClientError('Order tidak ditemukan')
  if (order.channel !== 'biteship') throw new ClientError('Buat resi Biteship hanya untuk channel Biteship')
  return order
}

function numericOrderId(gid: string) {
  const match = gid.match(/(\d+)$/)
  return match?.[1] ?? gid
}
