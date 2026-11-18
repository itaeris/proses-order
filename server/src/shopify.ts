export interface NormalizedOrder {
  id: string
  name: string
  createdAt: string
  customerName: string | null
  totalAmount: string | null
  currency: string | null
  financialStatus: string | null
  fulfillmentStatus: string | null
  fulfillBy: string | null
  itemCount: number
  itemsJson: string
  deliveryMethod: string | null
  shippingCountry: string | null
  shippingCity: string | null
  shippingAddress: string | null
  salesChannel: string | null
  trackingNumber: string | null
}

function shopHost(value: string) {
  const bare = value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (!bare) return ''
  if (bare.includes('.')) return bare
  return `${bare}.myshopify.com`
}

export function shopifyConfig() {
  const shop = shopHost(process.env.SHOPIFY_SHOP ?? '')
  const clientId = (process.env.SHOPIFY_CLIENT_ID ?? '').trim()
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET ?? '').trim()
  const staticToken = (process.env.SHOPIFY_ADMIN_TOKEN ?? '').trim()
  const version = (process.env.SHOPIFY_API_VERSION ?? '2026-10').trim() || '2026-10'
  const configured = Boolean(shop && ((clientId && clientSecret) || staticToken))
  return { shop, clientId, clientSecret, staticToken, version, configured }
}

let cachedToken = ''
let tokenExpiresAt = 0

function parseTokenBody(raw: string): { access_token?: string; expires_in?: number; error?: string; error_description?: string } {
  try {
    return JSON.parse(raw) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
  } catch {
    return {}
  }
}

function tokenErrorMessage(raw: string, body: { error?: string; error_description?: string }, status: number) {
  const title = raw.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ''
  const code = body.error || title.match(/Oauth error ([a-z0_]+)/i)?.[1] || ''
  if (code === 'app_not_installed') {
    return 'App Proses Order belum dipasang di toko. Di Dev Dashboard buka Installs, pasang app ke toko, setujui izinnya, lalu segarkan dashboard.'
  }
  const detail = body.error_description || code || title || `HTTP ${status}`
  return `Shopify menolak kredensial (${detail}).`
}

export async function accessToken() {
  const { shop, clientId, clientSecret, staticToken } = shopifyConfig()
  if (staticToken) return staticToken
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  const raw = await response.text()
  const body = parseTokenBody(raw)
  if (!response.ok || !body.access_token) {
    throw new Error(tokenErrorMessage(raw, body, response.status))
  }
  cachedToken = body.access_token
  tokenExpiresAt = Date.now() + (body.expires_in ?? 86399) * 1000
  return cachedToken
}

interface Money {
  amount?: string
  currencyCode?: string
}

interface OrderNode {
  id: string
  name: string
  createdAt: string
  displayFulfillmentStatus?: string | null
  displayFinancialStatus?: string | null
  currentTotalPriceSet?: { shopMoney?: Money | null } | null
  customer?: { displayName?: string | null } | null
  shippingAddress?: {
    countryCodeV2?: string | null
    city?: string | null
    province?: string | null
    zip?: string | null
    address1?: string | null
    address2?: string | null
    name?: string | null
    phone?: string | null
  } | null
  shippingLines?: { nodes?: Array<{ title?: string | null }> | null } | null
  lineItems?: {
    nodes?: Array<{
      name?: string | null
      quantity?: number | null
      sku?: string | null
      image?: { url?: string | null } | null
    }> | null
  } | null
  fulfillments?: Array<{ trackingInfo?: Array<{ number?: string | null }> | null }> | null
  sourceName?: string | null
  fulfillmentOrders?: { nodes?: Array<{ fulfillBy?: string | null }> | null } | null
}

const SOURCE_LABEL: Record<string, string> = {
  web: 'Online Store',
  pos: 'Point of Sale',
  shopify_draft_order: 'Draft Order',
  iphone: 'Mobile',
  android: 'Mobile',
}

function queryText(options: { sourceName: boolean; fulfillBy: boolean }) {
  return `query UnfulfilledOrders($cursor: String) {
    orders(
      first: 50
      after: $cursor
      query: "financial_status:paid AND (fulfillment_status:unfulfilled OR fulfillment_status:partial) AND status:open"
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        displayFulfillmentStatus
        displayFinancialStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        customer { displayName }
        shippingAddress { countryCodeV2 city province zip address1 address2 name phone }
        shippingLines(first: 5) { nodes { title } }
        lineItems(first: 40) { nodes { name quantity sku image { url } } }
        fulfillments(first: 10) { trackingInfo { number } }
        ${options.sourceName ? 'sourceName' : ''}
        ${options.fulfillBy ? 'fulfillmentOrders(first: 10) { nodes { fulfillBy } }' : ''}
      }
    }
  }`
}

function normalize(node: OrderNode): NormalizedOrder {
  const items = (node.lineItems?.nodes ?? []).map((item) => ({
    name: item.name || 'Item',
    quantity: item.quantity ?? 0,
    sku: item.sku ?? null,
    imageUrl: item.image?.url ?? null,
  }))
  const address = node.shippingAddress
  const addressText = [
    address?.name,
    address?.address1,
    address?.address2,
    address?.city,
    address?.province,
    address?.zip,
    address?.countryCodeV2,
    address?.phone,
  ]
    .filter((part) => part && String(part).trim())
    .join(', ')
  const fulfillBy = (node.fulfillmentOrders?.nodes ?? [])
    .map((entry) => entry.fulfillBy)
    .filter((value): value is string => !!value)
    .sort()[0] ?? null
  const tracking = (node.fulfillments ?? [])
    .flatMap((fulfillment) => fulfillment.trackingInfo ?? [])
    .map((info) => info.number)
    .find((number) => number && number.trim()) ?? null
  const source = node.sourceName ?? ''
  return {
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    customerName: node.customer?.displayName ?? address?.name ?? null,
    totalAmount: node.currentTotalPriceSet?.shopMoney?.amount ?? null,
    currency: node.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
    financialStatus: node.displayFinancialStatus ?? null,
    fulfillmentStatus: node.displayFulfillmentStatus ?? null,
    fulfillBy,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    itemsJson: JSON.stringify(items),
    deliveryMethod: node.shippingLines?.nodes?.[0]?.title ?? null,
    shippingCountry: address?.countryCodeV2 ?? null,
    shippingCity: address?.city ?? null,
    shippingAddress: addressText || null,
    salesChannel: SOURCE_LABEL[source] ?? (source || null),
    trackingNumber: tracking,
  }
}

async function graphql(
  query: string,
  variables: { cursor: string | null },
): Promise<{ orders: NormalizedOrder[]; hasNextPage: boolean; endCursor: string | null }> {
  const { shop, version } = shopifyConfig()
  const response = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': await accessToken(),
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Shopify menolak permintaan (${response.status}). ${text.slice(0, 180)}`)
  }
  const body = (await response.json()) as {
    data?: { orders?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: OrderNode[] } }
    errors?: Array<{ message?: string }>
  }
  if (body.errors?.length && !body.data?.orders) {
    throw new Error(body.errors.map((error) => error.message || 'Error Shopify').join('; '))
  }
  const connection = body.data?.orders
  if (!connection) throw new Error('Shopify tidak mengembalikan daftar order')
  return {
    orders: (connection.nodes ?? []).map(normalize),
    hasNextPage: !!connection.pageInfo?.hasNextPage,
    endCursor: connection.pageInfo?.endCursor ?? null,
  }
}

export async function fetchUnfulfilledOrders(): Promise<NormalizedOrder[]> {
  const options = { sourceName: true, fulfillBy: true }
  const collected: NormalizedOrder[] = []
  let cursor: string | null = null

  for (let page = 0; page < 40; page += 1) {
    let result: Awaited<ReturnType<typeof graphql>> | null = null
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        result = await graphql(queryText(options), { cursor })
        break
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/throttled/i.test(message) && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
          continue
        }
        if (options.fulfillBy && /fulfillBy|fulfillmentOrders/i.test(message)) {
          options.fulfillBy = false
          continue
        }
        if (options.sourceName && /sourceName/i.test(message)) {
          options.sourceName = false
          continue
        }
        throw error
      }
    }
    if (!result) throw new Error('Gagal mengambil order dari Shopify')
    collected.push(...result.orders)
    if (!result.hasNextPage || !result.endCursor) break
    cursor = result.endCursor
  }
  return collected
}
