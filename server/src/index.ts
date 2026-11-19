import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express, { type NextFunction, type Request, type Response } from 'express'
import { ensureDatabase, getJoined, getRules, getSyncState } from './db.js'
import {
  createIndocoliteShipment,
  indocoliteQuote,
  refreshIndocoliteShipment,
  requestIndocolitePickup,
  saveOrigin,
} from './indocolite.js'
import { applyAction, ClientError, listOrders, summary, toView, updateRules, type ListFilters } from './orders.js'
import { seedIfEmpty } from './seed.js'
import { shopifyConfig } from './shopify.js'
import { hasActiveSample } from './store.js'
import { syncFromShopify, syncInFlight } from './sync.js'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../.env') })

const app = express()
app.use(express.json())

let databaseReady: Promise<void> | null = null

function whenDatabaseReady() {
  if (!databaseReady) {
    databaseReady = ensureDatabase()
      .then(() => {
        startWork()
      })
      .catch((error) => {
        databaseReady = null
        throw error
      })
  }
  return databaseReady
}

app.use((req, _res, next) => {
  if (!req.path.startsWith('/api')) return next()
  whenDatabaseReady().then(() => next(), next)
})

app.get('/api/status', async (_req, res, next) => {
  try {
    const config = shopifyConfig()
    const state = await getSyncState()
    res.json({
      shopifyConfigured: config.configured,
      shop: config.shop || null,
      apiVersion: config.version,
      lastSyncAt: state.last_sync_at,
      lastError: state.last_error,
      lastCount: state.last_count,
      syncing: syncInFlight(),
      usingSample: await hasActiveSample(),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/orders', async (req, res, next) => {
  try {
    const filters: ListFilters = {
      q: stringQuery(req.query.q),
      channel: stringQuery(req.query.channel),
      warehouse: stringQuery(req.query.warehouse),
      awb: stringQuery(req.query.awb),
      overdue: req.query.overdue === '1',
      unclaimed: req.query.unclaimed === '1',
      view: stringQuery(req.query.view),
    }
    res.json({ orders: await listOrders(filters), summary: await summary() })
  } catch (error) {
    next(error)
  }
})

app.post('/api/orders/:id/actions', async (req, res, next) => {
  try {
    const order = await applyAction(req.params.id, req.body ?? {})
    res.json({ order })
  } catch (error) {
    next(error)
  }
})

app.get('/api/orders/:id/indocolite', async (req, res, next) => {
  try {
    const destinationId = Number(req.query.destinationId)
    res.json(await indocoliteQuote(req.params.id, destinationId > 0 ? destinationId : undefined))
  } catch (error) {
    next(asClient(error))
  }
})

app.post('/api/orders/:id/indocolite', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const id = req.params.id
    if (body.action === 'origin') {
      await saveOrigin(Number(body.originId))
      res.json(await indocoliteQuote(id))
      return
    }
    if (body.action === 'create') {
      const shipment = await createIndocoliteShipment({
        orderId: id,
        destinationId: Number(body.destinationId),
        shippingName: String(body.shippingName ?? ''),
        serviceName: String(body.serviceName ?? ''),
        cost: Number(body.cost),
      })
      res.json({ shipment, order: await currentOrder(id) })
      return
    }
    if (body.action === 'refresh') {
      const shipment = await refreshIndocoliteShipment(id)
      res.json({ shipment, order: await currentOrder(id) })
      return
    }
    if (body.action === 'pickup') {
      const shipment = await requestIndocolitePickup({
        orderId: id,
        date: String(body.date ?? ''),
        time: String(body.time ?? ''),
        vehicle: String(body.vehicle ?? ''),
      })
      res.json({ shipment, order: await currentOrder(id) })
      return
    }
    throw new ClientError('Aksi Indocolite tidak dikenal')
  } catch (error) {
    next(asClient(error))
  }
})

app.get('/api/routing', async (_req, res, next) => {
  try {
    res.json({ rules: await getRules() })
  } catch (error) {
    next(error)
  }
})

app.put('/api/routing', async (req, res, next) => {
  try {
    const rules = await updateRules(req.body?.rules ?? [])
    res.json({ rules })
  } catch (error) {
    next(error)
  }
})

async function handleSync(_req: Request, res: Response, next: NextFunction) {
  try {
    const count = await syncFromShopify()
    res.json({ count })
  } catch (error) {
    next(error)
  }
}

app.post('/api/sync', handleSync)
app.get('/api/sync', handleSync)

const onVercel = process.env.VERCEL === '1'
if (!onVercel) {
  const dist = path.resolve(here, '../../client/dist')
  app.use(express.static(dist))
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.method !== 'GET') return next()
    res.sendFile(path.join(dist, 'index.html'), (error) => {
      if (error) next()
    })
  })
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : 'Terjadi kesalahan'
  const status = error instanceof ClientError || /belum diatur/i.test(message) ? 400 : 500
  if (status === 500) console.error(error)
  res.status(status).json({ error: message })
})

let workStarted = false

function startWork() {
  if (workStarted) return
  workStarted = true
  if (!shopifyConfig().configured) {
    void seedIfEmpty()
    return
  }
  void syncFromShopify().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
  })
}

if (!onVercel) {
  const port = Number(process.env.PORT || 8787)
  app.listen(port, () => {
    console.log(`Proses order berjalan di http://127.0.0.1:${port}`)
  })

  const interval = Number(process.env.SYNC_INTERVAL_MS || 120000)
  setInterval(() => {
    if (!shopifyConfig().configured) return
    void syncFromShopify().catch(() => {})
  }, interval).unref()
}

export default app

function stringQuery(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function currentOrder(id: string) {
  const row = await getJoined(id)
  return row ? toView(row) : null
}

function asClient(error: unknown) {
  if (error instanceof ClientError) return error
  if (error instanceof Error) return new ClientError(error.message)
  return error
}
