export type ChannelId = 'indocolite' | 'biteship' | 'dhl' | 'unassigned'
export type CourierChannel = Exclude<ChannelId, 'unassigned'>
export type IndocoliteMode = 'manual' | 'otomatis'
export type WarehouseStep = 'print_label' | 'packing' | 'validasi_awb' | 'siap_pickup'

export interface RoutingRule {
  match: string
  channel: CourierChannel
}

export interface StepDef {
  id: string
  label: string
  state: 'done' | 'current' | 'upcoming'
}

export const DEFAULT_RULES: RoutingRule[] = [
  { match: 'JNE', channel: 'biteship' },
  { match: 'LION', channel: 'biteship' },
  { match: 'Ninja', channel: 'biteship' },
  { match: 'SiCepat', channel: 'biteship' },
  { match: 'J&T', channel: 'biteship' },
  { match: 'Anteraja', channel: 'biteship' },
  { match: 'POS', channel: 'indocolite' },
]

const BITESHIP: Array<Omit<StepDef, 'state'>> = [
  { id: 'antrian', label: 'Antrian' },
  { id: 'kirim_pesanan', label: 'Kirim pesanan' },
  { id: 'import_shopify', label: 'Import dari Shopify' },
  { id: 'lanjut_pembayaran', label: 'Lanjut pembayaran' },
  { id: 'bayar', label: 'Bayar sekarang' },
]

const DHL: Array<Omit<StepDef, 'state'>> = [
  { id: 'antrian', label: 'Antrian' },
  { id: 'print_close', label: 'Print dan close' },
]

export const WAREHOUSE_STEPS: Array<Omit<StepDef, 'state'>> = [
  { id: 'print_label', label: 'Print label' },
  { id: 'packing', label: 'Proses packing' },
  { id: 'validasi_awb', label: 'Validasi AWB' },
  { id: 'siap_pickup', label: 'Siap pickup' },
]

export function suggestChannel(
  country: string | null,
  method: string | null,
  rules: RoutingRule[],
): ChannelId {
  const code = (country ?? '').trim().toUpperCase()
  const title = method ?? ''
  if (code && code !== 'ID') return 'dhl'
  if (title.toLowerCase().includes('dhl')) return 'dhl'

  const hay = title.toLowerCase()
  const ordered = [...rules].sort((a, b) => b.match.length - a.match.length)
  for (const rule of ordered) {
    const needle = rule.match.trim().toLowerCase()
    if (needle && hay.includes(needle)) return rule.channel
  }
  return 'unassigned'
}

export function channelStepDefs(channel: ChannelId): Array<Omit<StepDef, 'state'>> {
  if (channel === 'biteship') return BITESHIP
  if (channel === 'dhl') return DHL
  if (channel === 'indocolite') {
    return [
      { id: 'antrian', label: 'Antrian' },
      { id: 'form_pengiriman', label: 'Form buat pengiriman' },
      { id: 'konfirmasi', label: 'Konfirmasi pengiriman' },
    ]
  }
  return []
}

export function decorateSteps(
  steps: Array<Omit<StepDef, 'state'>>,
  current: string,
  done: boolean,
): StepDef[] {
  const index = steps.findIndex((step) => step.id === current)
  return steps.map((step, i) => {
    let state: StepDef['state'] = 'upcoming'
    if (done || (index >= 0 && i < index)) state = 'done'
    else if (i === index) state = 'current'
    else if (index < 0 && i === 0) state = 'current'
    return { ...step, state }
  })
}

export function isOverdue(input: {
  createdAt: string
  fulfillBy: string | null
  warehouseStep: string
  now?: number
}): boolean {
  if (input.warehouseStep === 'siap_pickup') return false
  const now = input.now ?? Date.now()
  if (input.fulfillBy) {
    const due = new Date(input.fulfillBy).getTime()
    if (!Number.isNaN(due) && due < now) return true
  }
  const created = new Date(input.createdAt).getTime()
  return !Number.isNaN(created) && created < now - 24 * 60 * 60 * 1000
}

export function jakartaDate(value: string | Date = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export const CHANNEL_LABEL: Record<ChannelId, string> = {
  indocolite: 'Indocolite',
  biteship: 'Biteship',
  dhl: 'DHL',
  unassigned: 'Perlu dipilih',
}
