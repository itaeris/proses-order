import { remember as cached } from './cache.js'
import { getJoined, getSetting, setSetting, type JoinedRow } from './db.js'
import { ClientError, touch } from './orders.js'
import { jakartaDate } from './flow.js'

export interface DhlRate {
  productCode: string
  localProductCode: string
  shippingName: string
  serviceName: string
  cost: number
  currency: string
  etd: string
}

export interface DhlShipment {
  awb: string | null
  shippingName: string | null
  serviceName: string | null
  cost: number | null
  currency: string | null
  status: string
  hasLabel: boolean
  errorDetail: string | null
}

export interface DhlQuote {
  weightKg: number
  originPostalCode: string
  destinationPostalCode: string
  destinationCountry: string
  rates: DhlRate[]
  shipment: DhlShipment | null
  notice: string | null
}

function base() {
  return (process.env.DHL_API_BASE?.trim() || 'https://express.api.dhl.com/mydhlapi').replace(/\/$/, '')
}

function credentials() {
  const apiKey = process.env.DHL_API_KEY?.trim() ?? ''
  const apiSecret = process.env.DHL_API_SECRET?.trim() ?? ''
  const account = process.env.DHL_ACCOUNT_NUMBER?.trim() ?? ''
  if (!apiKey || !apiSecret || !account) {
    throw new ClientError('Isi DHL_API_KEY, DHL_API_SECRET, dan DHL_ACCOUNT_NUMBER')
  }
  return {
    account,
    header: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
  }
}

async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const auth = credentials()
  let response: Response
  try {
    response = await fetch(`${base()}${path}`, {
      ...init,
      headers: {
        Authorization: auth.header,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    if (error instanceof ClientError) throw error
    const reason = error instanceof Error ? error.message : 'gagal terhubung'
    throw new ClientError(`DHL tidak terjangkau (${reason})`)
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) return body
  throw new ClientError(dhlMessage(body, response.status))
}

function dhlMessage(body: Record<string, unknown>, status: number) {
  const reasons = Array.isArray(body.reasons)
    ? body.reasons.flatMap((row) => {
        if (!row || typeof row !== 'object') return []
        const msg = (row as Record<string, unknown>).msg
        return typeof msg === 'string' && msg.trim() ? [msg.trim()] : []
      })
    : []
  const details = Array.isArray(body.additionalDetails) ? body.additionalDetails.map(String) : []
  const detail = typeof body.detail === 'string' ? body.detail : ''
  const message = typeof body.message === 'string' ? body.message : ''
  const text = [...reasons, ...details, detail, message].filter(Boolean).join('. ')
  return text || `DHL menolak permintaan (${status})`
}

function shipmentKey(orderId: string) {
  return `dhl_shipment:${orderId}`
}

function labelKey(orderId: string) {
  return `dhl_label:${orderId}`
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function weightKg() {
  return numberEnv('PAKEET_DEFAULT_WEIGHT_KG', 1)
}

function sender() {
  const name = process.env.PAKEET_SENDER_NAME?.trim() ?? ''
  const phone = intlPhone(process.env.PAKEET_SENDER_PHONE?.trim() ?? '', 'ID')
  const address = process.env.PAKEET_SENDER_ADDRESS?.trim() ?? ''
  const city = process.env.PAKEET_SENDER_CITY?.trim() ?? ''
  const postalCode = process.env.PAKEET_SENDER_POSTAL_CODE?.trim() ?? ''
  if (!name || !phone || !address || !city || !postalCode) {
    throw new ClientError('Alamat gudang belum lengkap di .env')
  }
  return { name, phone, address, city, postalCode, country: 'ID' }
}

function intlPhone(value: string, country: string) {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  if (country === 'ID') {
    if (digits.startsWith('0')) return `+62${digits.slice(1)}`
    if (digits.startsWith('62')) return `+${digits}`
    return `+62${digits}`
  }
  return `+${digits.replace(/^00/, '')}`
}

function parseReceiver(order: JoinedRow) {
  const parts = (order.shipping_address ?? '').split(',').map((part) => part.trim()).filter(Boolean)
  const last = parts[parts.length - 1] ?? ''
  let phone = ''
  if (last.replace(/\D/g, '').length >= 8) phone = parts.pop() ?? ''
  const country = (order.shipping_country ?? '').trim().toUpperCase()
  if ((parts[parts.length - 1] ?? '').toUpperCase() === country) parts.pop()
  const zipCandidate = parts[parts.length - 1] ?? ''
  const zip = /\d/.test(zipCandidate) && zipCandidate.length <= 12 ? parts.pop() ?? '' : ''
  const city = (order.shipping_city ?? '').trim()
  if (city && parts[parts.length - 1]?.toLowerCase() === city.toLowerCase()) parts.pop()
  else if (parts.length > 2) {
    parts.pop()
    if (city && parts[parts.length - 1]?.toLowerCase() === city.toLowerCase()) parts.pop()
  }
  const name = parts.shift() || order.customer_name || 'Penerima'
  return {
    name,
    phone: intlPhone(phone, country),
    zip,
    city,
    country,
    street: parts.join(', '),
  }
}

function addressLines(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return ['-']
  const lines: string[] = []
  let rest = clean
  while (rest && lines.length < 3) {
    if (rest.length <= 45) {
      lines.push(rest)
      break
    }
    const cut = rest.lastIndexOf(' ', 45)
    const at = cut > 20 ? cut : 45
    lines.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  return lines
}

function shipWhen() {
  const today = jakartaDate()
  const [year, month, day] = today.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + 1))
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1)
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T10:00:00 GMT+07:00`
}

function party(input: { name: string; phone: string; street: string; city: string; postalCode: string; country: string }) {
  const lines = addressLines(input.street || input.city)
  return {
    postalAddress: {
      postalCode: input.postalCode,
      cityName: input.city.slice(0, 45),
      countryCode: input.country,
      addressLine1: lines[0],
      ...(lines[1] ? { addressLine2: lines[1] } : {}),
      ...(lines[2] ? { addressLine3: lines[2] } : {}),
    },
    contactInformation: {
      phone: input.phone.slice(0, 25),
      companyName: input.name.slice(0, 60),
      fullName: input.name.slice(0, 60),
    },
  }
}

async function loadShipment(orderId: string): Promise<DhlShipment | null> {
  const raw = await getSetting(shipmentKey(orderId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as DhlShipment
  } catch {
    return null
  }
}

function readRates(body: Record<string, unknown>): DhlRate[] {
  if (!Array.isArray(body.products)) return []
  const rates: DhlRate[] = []
  for (const row of body.products) {
    if (!row || typeof row !== 'object') continue
    const product = row as Record<string, unknown>
    const price = billPrice(product.totalPrice)
    const productCode = String(product.productCode ?? '')
    if (!price || !productCode) continue
    rates.push({
      productCode,
      localProductCode: String(product.localProductCode ?? productCode),
      shippingName: 'DHL',
      serviceName: String(product.productName ?? productCode),
      cost: price.cost,
      currency: price.currency,
      etd: etd(product),
    })
  }
  return rates.sort((a, b) => a.cost - b.cost)
}

function billPrice(value: unknown) {
  if (!Array.isArray(value)) return null
  const rows = value.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>
  const bill = rows.find((row) => row.currencyType === 'BILLC') ?? rows[0]
  const cost = Number(bill?.price)
  if (!bill || !Number.isFinite(cost)) return null
  return { cost, currency: String(bill.priceCurrency || 'IDR') }
}

function etd(product: Record<string, unknown>) {
  const caps = product.deliveryCapabilities
  if (!caps || typeof caps !== 'object') return ''
  const row = caps as Record<string, unknown>
  const when = String(row.estimatedDeliveryDateAndTime ?? row.estimatedDeliveryDate ?? '')
  if (when) return when.replace('T', ' ').slice(0, 16)
  return row.totalTransitDays ? `${row.totalTransitDays} hari` : ''
}

export async function dhlQuote(orderId: string): Promise<DhlQuote> {
  const order = await requireDhl(orderId)
  const from = sender()
  const to = parseReceiver(order)
  if (!/^[A-Z]{2}$/.test(to.country)) throw new ClientError('Negara penerima tidak terbaca dari alamat Shopify')
  if (!to.city) throw new ClientError('Kota penerima tidak terbaca dari alamat Shopify')
  if (!to.zip) throw new ClientError('Kode pos penerima tidak terbaca dari alamat Shopify')
  const kg = weightKg()
  const customs = to.country !== 'ID'
  const when = shipWhen()
  const body = await cached(`dhl:rates:${from.postalCode}:${to.country}:${to.zip}:${kg}:${customs}:${when}`, 45_000, () => call('/rates', {
    method: 'POST',
    body: JSON.stringify({
      customerDetails: {
        shipperDetails: {
          postalCode: from.postalCode,
          cityName: from.city,
          countryCode: from.country,
          addressLine1: addressLines(from.address)[0],
        },
        receiverDetails: {
          postalCode: to.zip,
          cityName: to.city,
          countryCode: to.country,
          addressLine1: addressLines(to.street || to.city)[0],
        },
      },
      accounts: [{ typeCode: 'shipper', number: credentials().account }],
      plannedShippingDateAndTime: when,
      unitOfMeasurement: 'metric',
      isCustomsDeclarable: customs,
      packages: [parcel(kg)],
    }),
  }))
  const rates = readRates(body)
  return {
    weightKg: kg,
    originPostalCode: from.postalCode,
    destinationPostalCode: to.zip,
    destinationCountry: to.country,
    rates,
    shipment: await loadShipment(order.id),
    notice: rates.length > 0 ? null : 'DHL tidak punya tarif untuk tujuan ini.',
  }
}

export async function createDhlShipment(input: { orderId: string; productCode: string; cost: number }) {
  const order = await requireDhl(input.orderId)
  const existing = await loadShipment(order.id)
  if (existing?.awb) throw new ClientError('Pengiriman untuk order ini sudah dibuat')
  const quote = await dhlQuote(order.id)
  const rate = quote.rates.find((row) => row.productCode === input.productCode)
  if (!rate || Math.abs(rate.cost - input.cost) > 0.01) {
    throw new ClientError('Ongkir itu sudah tidak berlaku. Muat ulang daftarnya.')
  }
  const from = sender()
  const to = parseReceiver(order)
  if (!to.phone || !to.street) throw new ClientError('Telepon atau alamat penerima tidak lengkap')
  const customs = to.country !== 'ID'
  const body = await call('/shipments', {
    method: 'POST',
    body: JSON.stringify({
      plannedShippingDateAndTime: shipWhen(),
      pickup: { isRequested: false },
      productCode: rate.productCode,
      localProductCode: rate.localProductCode,
      accounts: [{ typeCode: 'shipper', number: credentials().account }],
      outputImageProperties: {
        printerDPI: 300,
        encodingFormat: 'pdf',
        imageOptions: [{ typeCode: 'label', templateName: 'ECOM26_84_001' }],
      },
      customerReferences: [{ typeCode: 'CU', value: order.name.replace(/^#/, '').slice(0, 35) }],
      customerDetails: {
        shipperDetails: party({ ...from, street: from.address, postalCode: from.postalCode }),
        receiverDetails: party({ ...to, postalCode: to.zip }),
      },
      content: content(order, quote.weightKg, customs, rate.currency),
    }),
  })
  return remember(order, body, rate)
}

export async function refreshDhlShipment(orderId: string) {
  const order = await requireDhl(orderId)
  const record = await loadShipment(order.id)
  if (!record?.awb) throw new ClientError('Order ini belum punya resi DHL')
  const body = await call(`/tracking?shipmentTrackingNumber=${encodeURIComponent(record.awb)}`)
  const shipments = Array.isArray(body.shipments) ? body.shipments : []
  const first = shipments[0]
  const status = trackingStatus(first)
  const next = { ...record, status: status || record.status }
  await setSetting(shipmentKey(order.id), JSON.stringify(next))
  return next
}

export async function dhlLabel(orderId: string) {
  const order = await requireDhl(orderId)
  const content = await getSetting(labelKey(order.id))
  if (!content) throw new ClientError('Label DHL untuk order ini belum ada')
  return { content, format: 'pdf' }
}

async function remember(order: JoinedRow, body: Record<string, unknown>, rate: DhlRate): Promise<DhlShipment> {
  const awb = String(body.shipmentTrackingNumber ?? '').trim() || null
  const label = labelContent(body.documents)
  if (label) await setSetting(labelKey(order.id), label)
  const record: DhlShipment = {
    awb,
    shippingName: rate.shippingName,
    serviceName: rate.serviceName,
    cost: rate.cost,
    currency: rate.currency,
    status: awb ? 'dibuat' : 'tanpa resi',
    hasLabel: Boolean(label),
    errorDetail: awb ? null : 'DHL tidak mengembalikan nomor resi',
  }
  await setSetting(shipmentKey(order.id), JSON.stringify(record))
  if (awb) {
    await touch(order.id, {
      channel_step: 'print_close',
      channel_done: 1,
      ...(order.awb_validated_at ? {} : { awb_number: awb }),
    })
  }
  return record
}

function labelContent(value: unknown) {
  if (!Array.isArray(value)) return ''
  const rows = value.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>
  const label = rows.find((row) => row.typeCode === 'label' && typeof row.content === 'string') ?? rows.find((row) => typeof row.content === 'string')
  return typeof label?.content === 'string' ? label.content : ''
}

function trackingStatus(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  const row = value as Record<string, unknown>
  const events = Array.isArray(row.events) ? row.events : []
  const latest = events[0]
  if (latest && typeof latest === 'object') {
    const description = (latest as Record<string, unknown>).description
    if (typeof description === 'string' && description.trim()) return description.trim()
  }
  return typeof row.status === 'string' ? row.status : ''
}

function parcel(kg: number) {
  return {
    weight: kg,
    dimensions: {
      length: numberEnv('PAKEET_PACKAGE_LENGTH', 20),
      width: numberEnv('PAKEET_PACKAGE_WIDTH', 15),
      height: numberEnv('PAKEET_PACKAGE_HEIGHT', 10),
    },
  }
}

function content(order: JoinedRow, kg: number, customs: boolean, currency: string) {
  const items = lineItems(order)
  const declared = items.reduce((sum, item) => sum + item.price * item.quantity.value, 0)
  const description = items.map((item) => item.description).join(', ').slice(0, 70) || 'Beauty products'
  return {
    packages: [parcel(kg)],
    isCustomsDeclarable: customs,
    description,
    incoterm: 'DAP',
    unitOfMeasurement: 'metric',
    ...(customs
      ? {
          declaredValue: Math.max(1, Math.round(declared * 100) / 100),
          declaredValueCurrency: currency,
          exportDeclaration: {
            lineItems: items.map((item, index) => ({ number: index + 1, ...item })),
            invoice: { number: order.name.replace(/^#/, '').slice(0, 35), date: jakartaDate() },
            exportReasonType: 'permanent',
          },
        }
      : {}),
  }
}

function lineItems(order: JoinedRow) {
  const parsed = JSON.parse(order.items_json) as Array<{ name?: string; quantity?: number }>
  const items = parsed.length > 0 ? parsed : [{ name: 'Beauty products', quantity: 1 }]
  const totalQty = items.reduce((sum, item) => sum + Math.max(1, item.quantity || 1), 0)
  const total = Math.max(1, Number(order.total_amount ?? 0) || 1)
  const unit = Math.round((total / totalQty) * 100) / 100
  const eachWeight = Math.max(0.1, Math.round((weightKg() / items.length) * 100) / 100)
  const hs = (process.env.DHL_HS_CODE?.trim() || '330499').replace(/\D/g, '') || '330499'
  return items.map((item) => ({
    description: (item.name || 'Beauty products').slice(0, 70),
    price: unit,
    quantity: { value: Math.max(1, item.quantity || 1), unitOfMeasurement: 'PCS' },
    commodityCodes: [{ typeCode: 'outbound', value: hs }],
    weight: { netValue: eachWeight, grossValue: eachWeight },
    manufacturerCountry: 'ID',
  }))
}

async function requireDhl(orderId: string): Promise<JoinedRow> {
  const order = await getJoined(decodeURIComponent(orderId))
  if (!order) throw new ClientError('Order tidak ditemukan')
  if (order.channel !== 'dhl') throw new ClientError('Buat resi DHL hanya untuk channel DHL')
  return order
}
