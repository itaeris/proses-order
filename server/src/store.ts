import { suggestChannel } from './flow.js'
import type { NormalizedOrder } from './shopify.js'
import {
  countOrders,
  countSample,
  deactivateOtherRuns,
  existingProcessIds,
  getRules,
  insertProcessRows,
  upsertOrders,
  type ProcessRow,
} from './db.js'

export interface ProcessSeed {
  channel?: string
  channelLocked?: number
  indocoliteMode?: string | null
  channelStep?: string
  channelDone?: number
  warehouseStep?: string
  awbNumber?: string | null
  awbValidatedAt?: string | null
  awbValidatedBy?: string | null
  assignee?: string | null
  problemNote?: string | null
  readyAt?: string | null
}

function orderRow(order: NormalizedOrder, syncRun: string, now: string) {
  return {
    id: order.id,
    name: order.name,
    created_at: order.createdAt,
    customer_name: order.customerName,
    total_amount: order.totalAmount,
    currency: order.currency,
    financial_status: order.financialStatus,
    fulfillment_status: order.fulfillmentStatus,
    fulfill_by: order.fulfillBy,
    item_count: order.itemCount,
    items_json: order.itemsJson,
    delivery_method: order.deliveryMethod,
    shipping_country: order.shippingCountry,
    shipping_city: order.shippingCity,
    shipping_address: order.shippingAddress,
    sales_channel: order.salesChannel,
    tracking_number: order.trackingNumber,
    active: 1,
    sync_run: syncRun,
    updated_at: now,
  }
}

function processRow(order: NormalizedOrder, seed: ProcessSeed | undefined, channel: string, now: string): ProcessRow {
  return {
    order_id: order.id,
    channel,
    channel_locked: seed?.channelLocked ?? 0,
    indocolite_mode: seed?.indocoliteMode ?? null,
    channel_step: seed?.channelStep ?? 'antrian',
    channel_done: seed?.channelDone ?? 0,
    warehouse_step: seed?.warehouseStep ?? 'print_label',
    awb_number: seed?.awbNumber ?? null,
    awb_validated_at: seed?.awbValidatedAt ?? null,
    awb_validated_by: seed?.awbValidatedBy ?? null,
    assignee: seed?.assignee ?? null,
    problem_note: seed?.problemNote ?? null,
    ready_at: seed?.readyAt ?? null,
    updated_at: now,
  }
}

export async function saveOrder(order: NormalizedOrder, syncRun: string, seed?: ProcessSeed) {
  const now = new Date().toISOString()
  await upsertOrders([orderRow(order, syncRun, now)])
  const existing = await existingProcessIds([order.id])
  if (existing.has(order.id)) return
  const channel = seed?.channel ?? suggestChannel(order.shippingCountry, order.deliveryMethod, await getRules())
  await insertProcessRows([processRow(order, seed, channel, now)])
}

export async function saveOrders(orders: NormalizedOrder[], syncRun: string) {
  if (orders.length === 0) return
  const now = new Date().toISOString()
  for (let index = 0; index < orders.length; index += 200) {
    await upsertOrders(orders.slice(index, index + 200).map((order) => orderRow(order, syncRun, now)))
  }
  const existing = await existingProcessIds(orders.map((order) => order.id))
  const rules = await getRules()
  const fresh = orders
    .filter((order) => !existing.has(order.id))
    .map((order) => processRow(order, undefined, suggestChannel(order.shippingCountry, order.deliveryMethod, rules), now))
  for (let index = 0; index < fresh.length; index += 200) {
    await insertProcessRows(fresh.slice(index, index + 200))
  }
}

export async function deactivateMissing(syncRun: string) {
  await deactivateOtherRuns(syncRun)
}

export async function orderCount() {
  return countOrders()
}

export async function hasActiveSample() {
  return (await countSample()) > 0
}
