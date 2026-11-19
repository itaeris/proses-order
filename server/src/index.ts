import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express, { type NextFunction, type Request, type Response } from 'express'
import {
  AuthError,
  changePassword,
  clearSession,
  createUser,
  currentUser,
  ensureAdmin,
  listUsers,
  login,
  logout,
  signedIn,
  updateProfile,
  updateUser,
  writeSession,
} from './auth.js'
import { ensureDatabase, getJoined, getRules, getSyncState } from './db.js'
import { biteshipBalance, biteshipQuote, createBiteshipShipment, refreshBiteshipShipment } from './biteship.js'
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
dotenv.config({ path: path.resolve(here, '../../.env'), override: true })

const app = express()
app.use(express.json())

let databaseReady: Promise<void> | null = null

function whenDatabaseReady() {
  if (!databaseReady) {
    databaseReady = ensureDatabase()
      .then(() => ensureAdmin())
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

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next()
  if (req.path === '/api/login' && req.method === 'POST') return next()
  if (req.path === '/api/sync' && req.method === 'GET') return next()
  currentUser(req).then((user) => {
    if (!user) {
      next(new AuthError('Masuk dulu'))
      return
    }
    res.locals.user = user
    next()
  }, next)
})

app.post('/api/login', async (req, res, next) => {
  try {
    const remember = req.body?.remember === true
    const result = await login(String(req.body?.email ?? ''), String(req.body?.password ?? ''), remember)
    writeSession(res, result.token, remember)
    res.json(result.user)
  } catch (error) {
    next(error)
  }
})

app.post('/api/logout', async (req, res, next) => {
  try {
    await logout(readCookie(req, 'proses_session'))
    clearSession(res)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/me', (_req, res) => {
  res.json(signedIn(res))
})

app.post('/api/account/profile', async (req, res, next) => {
  try {
    const user = signedIn(res)
    const nextUser = await updateProfile(user.email, {
      name: String(req.body?.name ?? ''),
      email: String(req.body?.email ?? ''),
      phone: String(req.body?.phone ?? ''),
    })
    res.locals.user = nextUser
    res.json(nextUser)
  } catch (error) {
    next(error)
  }
})

app.post('/api/account/password', async (req, res, next) => {
  try {
    const user = signedIn(res)
    await changePassword(user.email, String(req.body?.currentPassword ?? ''), String(req.body?.nextPassword ?? ''))
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/users', async (_req, res, next) => {
  try {
    if (signedIn(res).role !== 'admin') throw new ClientError('Hanya admin yang bisa melihat pengguna')
    res.json(await listUsers())
  } catch (error) {
    next(error)
  }
})

app.post('/api/users/update', async (req, res, next) => {
  try {
    const actor = signedIn(res)
    if (actor.role !== 'admin') throw new ClientError('Hanya admin yang bisa mengubah pengguna')
    const nextUser = await updateUser(String(req.body?.currentEmail ?? ''), {
      name: String(req.body?.name ?? ''),
      email: String(req.body?.email ?? ''),
      phone: String(req.body?.phone ?? ''),
      role: String(req.body?.role ?? ''),
      password: String(req.body?.password ?? ''),
    })
    if (actor.email === String(req.body?.currentEmail ?? '').trim().toLowerCase()) res.locals.user = nextUser
    res.json(nextUser)
  } catch (error) {
    next(error)
  }
})

app.post('/api/users', async (req, res, next) => {
  try {
    if (signedIn(res).role !== 'admin') throw new ClientError('Hanya admin yang bisa menambah pengguna')
    res.json(await createUser({
      email: String(req.body?.email ?? ''),
      name: String(req.body?.name ?? ''),
      password: String(req.body?.password ?? ''),
    }))
  } catch (error) {
    next(error)
  }
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
    const order = await applyAction(req.params.id, req.body ?? {}, signedIn(res).name)
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

app.get('/api/orders/:id/biteship', async (req, res, next) => {
  try {
    res.json(await biteshipQuote(req.params.id))
  } catch (error) {
    next(asClient(error))
  }
})

app.post('/api/orders/:id/biteship', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const id = req.params.id
    if (body.action === 'create') {
      const shipment = await createBiteshipShipment({
        orderId: id,
        company: String(body.company ?? ''),
        serviceCode: String(body.serviceCode ?? ''),
        cost: Number(body.cost),
      })
      res.json({ shipment, order: await currentOrder(id), balance: await biteshipBalance() })
      return
    }
    if (body.action === 'refresh') {
      const shipment = await refreshBiteshipShipment(id)
      res.json({ shipment, order: await currentOrder(id), balance: await biteshipBalance() })
      return
    }
    throw new ClientError('Aksi Biteship tidak dikenal')
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
  const status = error instanceof AuthError ? 401 : error instanceof ClientError || /belum diatur/i.test(message) ? 400 : 500
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

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie
  if (!header) return ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
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
