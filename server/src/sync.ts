import { listJoined, refreshOrderList, setSyncState, type JoinedRow } from './db.js'
import { fetchUnfulfilledOrders, shopifyConfig, type NormalizedOrder } from './shopify.js'
import { deactivateMissing, saveOrders } from './store.js'

let current: Promise<number> | null = null

export function syncInFlight() {
  return current !== null
}

export function syncFromShopify(): Promise<number> {
  if (current) return current
  current = run().finally(() => {
    current = null
  })
  return current
}

function stamp(value: string | null) {
  if (!value) return ''
  const time = Date.parse(value)
  return Number.isNaN(time) ? value : String(time)
}

function shopifyMark(order: NormalizedOrder) {
  return [
    order.id,
    order.name,
    order.customerName ?? '',
    order.totalAmount ?? '',
    order.currency ?? '',
    order.financialStatus ?? '',
    order.fulfillmentStatus ?? '',
    stamp(order.fulfillBy),
    order.itemCount,
    order.itemsJson,
    order.deliveryMethod ?? '',
    order.shippingCountry ?? '',
    order.shippingCity ?? '',
    order.shippingAddress ?? '',
    order.salesChannel ?? '',
    order.trackingNumber ?? '',
  ].join('\u001f')
}

function storedMark(row: JoinedRow) {
  return [
    row.id,
    row.name,
    row.customer_name ?? '',
    row.total_amount ?? '',
    row.currency ?? '',
    row.financial_status ?? '',
    row.fulfillment_status ?? '',
    stamp(row.fulfill_by),
    row.item_count,
    row.items_json,
    row.delivery_method ?? '',
    row.shipping_country ?? '',
    row.shipping_city ?? '',
    row.shipping_address ?? '',
    row.sales_channel ?? '',
    row.tracking_number ?? '',
  ].join('\u001f')
}

function sameOrders(incoming: NormalizedOrder[], stored: JoinedRow[]) {
  const live = stored.filter((row) => row.active === 1 && row.sync_run !== 'sample')
  if (live.length !== incoming.length) return false
  const marks = new Set(live.map(storedMark))
  return incoming.every((order) => marks.has(shopifyMark(order)))
}

async function run(): Promise<number> {
  if (!shopifyConfig().configured) {
    throw new Error('Shopify belum diatur. Isi SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, dan SHOPIFY_CLIENT_SECRET di file .env')
  }
  try {
    const orders = await fetchUnfulfilledOrders()
    const stored = await listJoined()
    if (!sameOrders(orders, stored)) {
      const syncRun = `shopify-${Date.now()}`
      await saveOrders(orders, syncRun)
      await deactivateMissing(syncRun)
      await refreshOrderList()
    }
    await setSyncState({ last_sync_at: new Date().toISOString(), last_error: null, last_count: orders.length })
    return orders.length
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync Shopify gagal'
    await setSyncState({ last_error: message })
    throw error
  }
}
