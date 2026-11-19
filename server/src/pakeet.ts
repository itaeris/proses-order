const base = () => (process.env.PAKEET_API_BASE?.trim() || 'https://app.pakeet.id').replace(/\/$/, '')

export interface PakeetDestination {
  id: number
  label: string
  subdistrict_name: string
  district_name: string
  city_name: string
  province_name: string
  zip_code: string
}

export interface PakeetRate {
  shippingName: string
  serviceName: string
  cost: number
  etd: string
}

interface PakeetBody {
  success?: boolean
  message?: string
  error_detail?: string | null
  data?: unknown
}

function token() {
  const value = process.env.PAKEET_API_TOKEN?.trim()
  if (!value) throw new Error('PAKEET_API_TOKEN belum diisi di .env')
  return value
}

export async function pakeet(path: string, init?: RequestInit): Promise<PakeetBody> {
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const body = (await response.json().catch(() => ({}))) as PakeetBody
  if (!response.ok || body.success === false) {
    throw new Error(body.message || body.error_detail || `Pakeet menolak permintaan (${response.status})`)
  }
  return body
}

export async function pakeetBalance(): Promise<number> {
  const body = await pakeet('/api/v1/wallet/balance')
  const data = body.data as { balance?: number } | undefined
  return Number(data?.balance ?? 0)
}

export async function searchDestinations(keyword: string): Promise<PakeetDestination[]> {
  const query = keyword.trim()
  if (query.length < 2) return []
  const body = await pakeet(`/api/v1/shipping/destination-search?keyword=${encodeURIComponent(query)}`)
  const rows = Array.isArray(body.data) ? body.data : []
  return rows.map((row) => {
    const item = row as PakeetDestination
    return {
      id: Number(item.id),
      label: String(item.label ?? ''),
      subdistrict_name: String(item.subdistrict_name ?? ''),
      district_name: String(item.district_name ?? ''),
      city_name: String(item.city_name ?? ''),
      province_name: String(item.province_name ?? ''),
      zip_code: String(item.zip_code ?? ''),
    }
  })
}

export async function calculateRates(input: {
  originId: number
  destinationId: number
  weightGrams: number
  itemValue: number
}): Promise<PakeetRate[]> {
  const body = await pakeet('/api/v1/shipping/calculate', {
    method: 'POST',
    body: JSON.stringify({
      origin_destination_id: input.originId,
      receiver_destination_id: input.destinationId,
      weight: input.weightGrams,
      item_value: input.itemValue,
      cod: 'no',
      length: numberEnv('PAKEET_PACKAGE_LENGTH', 20),
      width: numberEnv('PAKEET_PACKAGE_WIDTH', 15),
      height: numberEnv('PAKEET_PACKAGE_HEIGHT', 10),
    }),
  })
  const data = body.data as { calculate_reguler?: Array<Record<string, unknown>> } | undefined
  return (data?.calculate_reguler ?? []).map((row) => ({
    shippingName: String(row.shipping_name ?? ''),
    serviceName: String(row.service_name ?? ''),
    cost: Number(row.shipping_cost ?? 0),
    etd: String(row.etd ?? ''),
  }))
}

export function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}
