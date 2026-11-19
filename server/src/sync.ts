import { setSyncState } from './db.js'
import { fetchUnfulfilledOrders, shopifyConfig } from './shopify.js'
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

async function run(): Promise<number> {
  if (!shopifyConfig().configured) {
    throw new Error('Shopify belum diatur. Isi SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, dan SHOPIFY_CLIENT_SECRET di file .env')
  }
  try {
    const orders = await fetchUnfulfilledOrders()
    const syncRun = `shopify-${Date.now()}`
    await saveOrders(orders, syncRun)
    await deactivateMissing(syncRun)
    await setSyncState({ last_sync_at: new Date().toISOString(), last_error: null, last_count: orders.length })
    return orders.length
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync Shopify gagal'
    await setSyncState({ last_error: message })
    throw error
  }
}
