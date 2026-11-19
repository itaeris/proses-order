import { getJoined, getRules, listJoined, saveRules, updateProcess, type JoinedRow, type ProcessRow } from './db.js'

export class ClientError extends Error {}
import {
  channelStepDefs,
  decorateSteps,
  isOverdue,
  jakartaDate,
  suggestChannel,
  WAREHOUSE_STEPS,
  type ChannelId,
  type CourierChannel,
  type RoutingRule,
  type WarehouseStep,
} from './flow.js'

export interface OrderItem {
  name: string
  quantity: number
  sku: string | null
  imageUrl?: string | null
}

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
  channelSteps: ReturnType<typeof decorateSteps>
  warehouseStep: WarehouseStep
  warehouseSteps: ReturnType<typeof decorateSteps>
  awbNumber: string | null
  awbValidatedAt: string | null
  awbValidatedBy: string | null
  assignee: string | null
  problemNote: string | null
  readyAt: string | null
  overdue: boolean
  readyToday: boolean
}

function asChannel(value: string): ChannelId {
  if (value === 'indocolite' || value === 'biteship' || value === 'dhl') return value
  return 'unassigned'
}

function asWarehouse(value: string): WarehouseStep {
  if (value === 'packing' || value === 'validasi_awb' || value === 'siap_pickup') return value
  return 'print_label'
}

export function toView(row: JoinedRow, now = Date.now()): OrderView {
  const channel = asChannel(row.channel)
  const warehouseStep = asWarehouse(row.warehouse_step)
  const mode = row.indocolite_mode
  const defs = channelStepDefs(channel, mode)
  const overdue = isOverdue({
    createdAt: row.created_at,
    fulfillBy: row.fulfill_by,
    warehouseStep,
    now,
  })
  let items: OrderItem[] = []
  try {
    items = JSON.parse(row.items_json) as OrderItem[]
  } catch {
    items = []
  }
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    customerName: row.customer_name || 'Tanpa nama',
    totalAmount: row.total_amount,
    currency: row.currency || 'IDR',
    financialStatus: row.financial_status,
    fulfillmentStatus: row.fulfillment_status,
    fulfillBy: row.fulfill_by,
    itemCount: row.item_count,
    items,
    deliveryMethod: row.delivery_method,
    shippingCountry: row.shipping_country,
    shippingCity: row.shipping_city,
    shippingAddress: row.shipping_address,
    salesChannel: row.sales_channel,
    trackingNumber: row.tracking_number,
    active: row.active === 1,
    sample: row.sync_run === 'sample',
    channel,
    channelLocked: row.channel_locked === 1,
    indocoliteMode: mode,
    needsMode: channel === 'indocolite' && mode !== 'manual' && mode !== 'otomatis',
    channelStep: row.channel_step,
    channelDone: row.channel_done === 1,
    channelSteps: decorateSteps(defs, row.channel_step, row.channel_done === 1),
    warehouseStep,
    warehouseSteps: decorateSteps(WAREHOUSE_STEPS, warehouseStep, warehouseStep === 'siap_pickup'),
    awbNumber: row.awb_number,
    awbValidatedAt: row.awb_validated_at,
    awbValidatedBy: row.awb_validated_by,
    assignee: row.assignee,
    problemNote: row.problem_note,
    readyAt: row.ready_at,
    overdue,
    readyToday: row.ready_at ? jakartaDate(row.ready_at) === jakartaDate(new Date(now)) : false,
  }
}

export interface ListFilters {
  q?: string
  channel?: string
  warehouse?: string
  awb?: string
  overdue?: boolean
  unclaimed?: boolean
  view?: string
}

function rank(order: OrderView): number {
  if (order.overdue) return 0
  if (order.channel === 'unassigned') return 1
  if (order.warehouseStep === 'validasi_awb' && !order.awbValidatedAt) return 2
  if (!order.assignee) return 3
  return 4
}

export async function listOrders(filters: ListFilters): Promise<OrderView[]> {
  const view = filters.view || 'active'
  let orders = (await listJoined()).map((row) => toView(row))

  if (view === 'ready') {
    orders = orders.filter((order) => order.active && order.warehouseStep === 'siap_pickup')
  } else if (view === 'awaiting_awb') {
    orders = orders.filter(
      (order) => order.active && order.warehouseStep === 'validasi_awb' && !order.awbValidatedAt,
    )
  } else if (view === 'all_active') {
    orders = orders.filter((order) => order.active)
  } else {
    orders = orders.filter((order) => order.active && order.warehouseStep !== 'siap_pickup')
  }

  if (filters.channel && filters.channel !== 'all') {
    orders = orders.filter((order) => order.channel === filters.channel)
  }
  if (filters.warehouse && filters.warehouse !== 'all') {
    orders = orders.filter((order) => order.warehouseStep === filters.warehouse)
  }
  if (filters.awb === 'missing') orders = orders.filter((order) => !order.awbNumber)
  if (filters.awb === 'pending') {
    orders = orders.filter((order) => !!order.awbNumber && !order.awbValidatedAt)
  }
  if (filters.awb === 'validated') orders = orders.filter((order) => !!order.awbValidatedAt)
  if (filters.overdue) orders = orders.filter((order) => order.overdue)
  if (filters.unclaimed) {
    orders = orders.filter((order) => !order.assignee && order.warehouseStep !== 'siap_pickup')
  }
  if (filters.q) {
    const q = filters.q.trim().toLowerCase()
    orders = orders.filter((order) => {
      const blob = [order.name, order.customerName, order.awbNumber, order.deliveryMethod, order.assignee]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }

  orders.sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    return a.createdAt.localeCompare(b.createdAt)
  })
  return orders
}

export async function summary() {
  const orders = (await listJoined()).map((row) => toView(row)).filter((order) => order.active)
  const byChannel = { indocolite: 0, biteship: 0, dhl: 0, unassigned: 0 }
  let unclaimed = 0
  let awaitingAwb = 0
  let overdue = 0
  let readyToday = 0
  let queue = 0
  for (const order of orders) {
    byChannel[order.channel] += 1
    if (order.warehouseStep !== 'siap_pickup' && !order.assignee) unclaimed += 1
    if (order.warehouseStep === 'validasi_awb' && !order.awbValidatedAt) awaitingAwb += 1
    if (order.overdue) overdue += 1
    if (order.readyToday) readyToday += 1
    if (order.warehouseStep !== 'siap_pickup') queue += 1
  }
  return { unclaimed, awaitingAwb, overdue, readyToday, queue, byChannel, active: orders.length }
}

export async function touch(id: string, fields: Partial<ProcessRow>) {
  const current = await getJoined(id)
  if (!current) throw new ClientError('Order tidak ditemukan')
  const next: ProcessRow = {
    order_id: current.order_id,
    channel: current.channel,
    channel_locked: current.channel_locked,
    indocolite_mode: current.indocolite_mode,
    channel_step: current.channel_step,
    channel_done: current.channel_done,
    warehouse_step: current.warehouse_step,
    awb_number: current.awb_number,
    awb_validated_at: current.awb_validated_at,
    awb_validated_by: current.awb_validated_by,
    assignee: current.assignee,
    problem_note: current.problem_note,
    ready_at: current.ready_at,
    updated_at: new Date().toISOString(),
    ...fields,
  }
  applyReady(next)
  await updateProcess(next)
}

function applyReady(row: ProcessRow) {
  const channelDone = row.channel_done === 1
  const awbOk = !!row.awb_validated_at && !!(row.awb_number ?? '').trim()
  const packed = row.warehouse_step === 'validasi_awb' || row.warehouse_step === 'siap_pickup'
  const channelOk = row.channel === 'indocolite' || row.channel === 'biteship' || row.channel === 'dhl'
  if (channelDone && awbOk && packed && channelOk) {
    row.warehouse_step = 'siap_pickup'
    if (!row.ready_at) row.ready_at = new Date().toISOString()
    return
  }
  if (row.warehouse_step === 'siap_pickup') {
    row.warehouse_step = 'validasi_awb'
    row.ready_at = null
  }
}

async function requireOrder(id: string): Promise<JoinedRow> {
  const row = await getJoined(id)
  if (!row) throw new ClientError('Order tidak ditemukan')
  return row
}

export interface ActionBody {
  action?: string
  assignee?: string
  channel?: string
  mode?: string
  awbNumber?: string
  by?: string
  note?: string
}

export async function applyAction(id: string, body: ActionBody): Promise<OrderView> {
  const row = await requireOrder(id)
  const action = body.action
  if (action === 'claim') {
    const assignee = (body.assignee ?? '').trim()
    if (!assignee) throw new ClientError('Isi nama petugas')
    await touch(id, { assignee })
  } else if (action === 'release') {
    await touch(id, { assignee: null })
  } else if (action === 'set_channel') {
    const channel = body.channel
    if (channel !== 'indocolite' && channel !== 'biteship' && channel !== 'dhl') {
      throw new ClientError('Channel tidak dikenal')
    }
    if (row.channel === channel) return toView(await requireOrder(id))
    if (row.delivery_method && row.indocolite_mode !== 'manual') {
      throw new ClientError('Metode kirim sudah dipilih di Shopify. Ganti kurir hanya lewat Manual.')
    }
    await touch(id, {
      channel,
      channel_locked: 1,
      indocolite_mode: row.indocolite_mode === 'manual' ? 'manual' : null,
      channel_step: 'antrian',
      channel_done: 0,
      awb_validated_at: null,
      awb_validated_by: null,
    })
  } else if (action === 'set_mode') {
    if (body.mode !== 'manual' && body.mode !== 'otomatis') throw new ClientError('Pilih manual atau otomatis')
    if (body.mode === 'manual') {
      if (row.indocolite_mode === 'manual') return toView(row)
      await touch(id, {
        indocolite_mode: 'manual',
        channel_locked: 1,
        ...(row.channel === 'indocolite' ? { channel_step: 'antrian', channel_done: 0 } : {}),
      })
    } else {
      const suggested = suggestChannel(row.shipping_country, row.delivery_method, await getRules())
      const channel = suggested === 'unassigned' ? row.channel : suggested
      const nextMode = channel === 'indocolite' ? 'otomatis' : null
      if (row.channel === channel && row.indocolite_mode === nextMode) return toView(row)
      await touch(id, {
        channel,
        channel_locked: row.delivery_method && suggested !== 'unassigned' ? 0 : row.channel_locked,
        indocolite_mode: nextMode,
        channel_step: 'antrian',
        channel_done: 0,
      })
    }
  } else if (action === 'advance_channel') {
    if (row.channel === 'unassigned') throw new ClientError('Pilih channel kurir dulu')
    if (row.channel === 'indocolite' && row.indocolite_mode !== 'manual' && row.indocolite_mode !== 'otomatis') {
      throw new ClientError('Pilih pengiriman manual atau otomatis')
    }
    if (row.channel_done === 1) throw new ClientError('Langkah kurir sudah selesai')
    const steps = channelStepDefs(asChannel(row.channel), row.indocolite_mode)
    const index = steps.findIndex((step) => step.id === row.channel_step)
    const at = index < 0 ? 0 : index
    if (at >= steps.length - 1) {
      await touch(id, { channel_done: 1, channel_step: steps[at]?.id ?? row.channel_step })
    } else {
      await touch(id, { channel_step: steps[at + 1].id })
    }
  } else if (action === 'retreat_channel') {
    if (row.channel_done === 1) {
      await touch(id, { channel_done: 0 })
    } else {
      const steps = channelStepDefs(asChannel(row.channel), row.indocolite_mode)
      const index = steps.findIndex((step) => step.id === row.channel_step)
      if (index <= 0) throw new ClientError('Sudah di langkah pertama')
      await touch(id, { channel_step: steps[index - 1].id })
    }
  } else if (action === 'advance_warehouse') {
    if (row.warehouse_step === 'print_label') await touch(id, { warehouse_step: 'packing' })
    else if (row.warehouse_step === 'packing') await touch(id, { warehouse_step: 'validasi_awb' })
    else throw new ClientError('Langkah gudang ini tidak bisa dilanjutkan dari sini')
  } else if (action === 'retreat_warehouse') {
    if (row.warehouse_step === 'packing') await touch(id, { warehouse_step: 'print_label' })
    else if (row.warehouse_step === 'validasi_awb' || row.warehouse_step === 'siap_pickup') {
      await touch(id, {
        warehouse_step: 'packing',
        awb_validated_at: null,
        awb_validated_by: null,
        ready_at: null,
      })
    } else {
      throw new ClientError('Sudah di langkah pertama')
    }
  } else if (action === 'validate_awb') {
    if (row.channel === 'unassigned') throw new ClientError('Pilih channel kurir dulu')
    if (row.warehouse_step === 'print_label' || row.warehouse_step === 'packing') {
      throw new ClientError('Selesaikan print label dan packing dulu')
    }
    const awb = (body.awbNumber ?? '').trim()
    if (!awb) throw new ClientError('Nomor resi wajib diisi')
    const by = (body.by ?? row.assignee ?? '').trim() || null
    await touch(id, {
      awb_number: awb,
      awb_validated_at: new Date().toISOString(),
      awb_validated_by: by,
      warehouse_step: 'validasi_awb',
    })
  } else if (action === 'revoke_awb') {
    await touch(id, {
      awb_validated_at: null,
      awb_validated_by: null,
      warehouse_step: row.warehouse_step === 'print_label' ? 'print_label' : 'validasi_awb',
      ready_at: null,
    })
  } else if (action === 'set_problem') {
    const note = (body.note ?? '').trim()
    await touch(id, { problem_note: note || null })
  } else {
    throw new ClientError('Aksi tidak dikenal')
  }
  return toView(await requireOrder(id))
}

const COURIERS = new Set<CourierChannel>(['indocolite', 'biteship', 'dhl'])

export async function updateRules(input: RoutingRule[]) {
  if (!Array.isArray(input) || input.length > 40) throw new ClientError('Peta kurir tidak valid')
  const rules: RoutingRule[] = []
  for (const rule of input) {
    const match = (rule.match ?? '').trim()
    if (!match || match.length > 60) throw new ClientError('Kata kunci kurir kosong atau terlalu panjang')
    if (!COURIERS.has(rule.channel)) throw new ClientError('Channel pada peta kurir tidak dikenal')
    rules.push({ match, channel: rule.channel })
  }
  await saveRules(rules)
  const rows = (await listJoined()).filter(
    (row) => row.channel_locked === 0 && row.channel_done === 0 && row.channel_step === 'antrian',
  )
  for (const row of rows) {
    const next = suggestChannel(row.shipping_country, row.delivery_method, rules)
    if (next !== row.channel) {
      await touch(row.id, {
        channel: next,
        indocolite_mode: null,
        channel_step: 'antrian',
        channel_done: 0,
      })
    }
  }
  return await getRules()
}
