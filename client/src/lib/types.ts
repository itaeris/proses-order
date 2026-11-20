export interface StepDef {
  id: string
  label: string
  state: 'done' | 'current' | 'upcoming'
}

export interface OrderItem {
  name: string
  quantity: number
  sku: string | null
  imageUrl?: string | null
}

export type ChannelId = 'indocolite' | 'biteship' | 'dhl' | 'unassigned'
export type WarehouseStep =
  | 'print_label'
  | 'packing'
  | 'kurir'
  | 'buat_resi'
  | 'ajukan_pickup'
  | 'form_pengiriman'
  | 'konfirmasi'
  | 'validasi_awb'
  | 'siap_pickup'

export interface OrderView {
  id: string
  name: string
  createdAt: string
  customerName: string
  totalAmount: string | null
  currency: string
  financialStatus: string | null
  fulfillmentStatus: string | null
  fulfillBy: string | null
  itemCount: number
  items: OrderItem[]
  deliveryMethod: string | null
  shippingCountry: string | null
  shippingCity: string | null
  shippingAddress: string | null
  salesChannel: string | null
  trackingNumber: string | null
  active: boolean
  sample: boolean
  channel: ChannelId
  channelLocked: boolean
  indocoliteMode: string | null
  needsMode: boolean
  channelStep: string
  channelDone: boolean
  channelSteps: StepDef[]
  warehouseStep: WarehouseStep
  warehouseSteps: StepDef[]
  awbNumber: string | null
  awbValidatedAt: string | null
  awbValidatedBy: string | null
  assignee: string | null
  problemNote: string | null
  readyAt: string | null
  overdue: boolean
  readyToday: boolean
}

export interface Summary {
  unclaimed: number
  awaitingAwb: number
  overdue: number
  readyToday: number
  queue: number
  byChannel: Record<ChannelId, number>
  unassigned: number
  active: number
}

export interface StatusInfo {
  shopifyConfigured: boolean
  shop: string | null
  apiVersion: string
  lastSyncAt: string | null
  lastError: string | null
  lastCount: number | null
  syncing: boolean
  usingSample: boolean
}

export interface RoutingRule {
  match: string
  channel: Exclude<ChannelId, 'unassigned'>
}

export const CHANNEL_LABEL: Record<ChannelId, string> = {
  indocolite: 'Indocolite',
  biteship: 'Biteship',
  dhl: 'DHL',
  unassigned: 'Perlu dipilih',
}

export const WAREHOUSE_LABEL: Record<WarehouseStep, string> = {
  print_label: 'Print label',
  packing: 'Proses packing',
  kurir: 'Kurir',
  buat_resi: 'Buat resi',
  ajukan_pickup: 'Ajukan pickup',
  form_pengiriman: 'Form buat kiriman',
  konfirmasi: 'Konfirmasi pengiriman',
  validasi_awb: 'Validasi AWB',
  siap_pickup: 'Siap pickup',
}
