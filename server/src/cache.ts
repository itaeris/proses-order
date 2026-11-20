import { createClient, type RedisClientType } from 'redis'

type Box = { value: unknown; expires: number }

const memory = new Map<string, Box>()
const pending = new Map<string, Promise<unknown>>()
const localGen = new Map<string, number>()

let client: RedisClientType | null = null
let connecting: Promise<RedisClientType | null> | null = null

function redisUrl() {
  return process.env.REDIS_URL?.trim() || ''
}

function redisParts() {
  const host = process.env.REDIS_HOST?.trim() || ''
  const username = process.env.REDIS_USERNAME?.trim() || ''
  const password = process.env.REDIS_PASSWORD?.trim() || ''
  const port = Number(process.env.REDIS_PORT || 6379)
  if (!host || !username || !password) return null
  return { host, port, username, password }
}

function keyPrefix() {
  const raw = process.env.REDIS_PREFIX?.trim() || 'prosesorder:'
  return raw.endsWith(':') ? raw : `${raw}:`
}

function fullKey(key: string) {
  return `${keyPrefix()}${key}`
}

export async function openCache() {
  const db = await redis()
  if (db) console.log('Redis tersambung')
  else if (redisParts() || redisUrl()) console.log('Redis tidak tersambung, cache tetap di memori')
}

async function redis(): Promise<RedisClientType | null> {
  const parts = redisParts()
  if (!parts && !redisUrl()) return null
  if (client?.isReady) return client
  if (!connecting) {
    connecting = (async () => {
      const socket = {
        connectTimeout: 5000,
        reconnectStrategy: (retries: number) => (retries > 2 ? false : retries * 200),
      }
      const next = parts
        ? createClient({
            username: parts.username,
            password: parts.password,
            socket: { ...socket, host: parts.host, port: parts.port },
          })
        : createClient({ url: redisUrl(), socket })
      next.on('error', () => {})
      try {
        await next.connect()
      } catch {
        await next.disconnect().catch(() => {})
        client = null
        return null
      }
      client = next as RedisClientType
      return client
    })().finally(() => {
      connecting = null
    })
  }
  return connecting
}

function pack(value: unknown) {
  return JSON.stringify({ u: value === undefined, v: value === undefined ? null : value })
}

function unpack<T>(raw: string): T {
  const box = JSON.parse(raw) as { u?: boolean; v: T }
  return (box.u ? undefined : box.v) as T
}

async function generation(key: string, db: RedisClientType | null) {
  if (!db) return localGen.get(key) ?? 0
  const raw = await db.get(fullKey(`gen:${key}`))
  return Number(raw ?? 0)
}

async function bump(key: string, db: RedisClientType | null) {
  localGen.set(key, (localGen.get(key) ?? 0) + 1)
  if (db) await db.incr(fullKey(`gen:${key}`))
}

function readMemory<T>(key: string): T | undefined {
  const hit = memory.get(key)
  if (!hit || hit.expires <= Date.now()) return undefined
  return hit.value as T
}

async function rememberLocal<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const box = memory.get(key)
  if (box && box.expires > Date.now()) return box.value as T
  const flight = pending.get(key)
  if (flight) return flight as Promise<T>
  const seen = localGen.get(key) ?? 0
  const job = load().then(
    (value) => {
      pending.delete(key)
      if ((localGen.get(key) ?? 0) === seen) memory.set(key, { value, expires: Date.now() + ttlMs })
      return value
    },
    (error: unknown) => {
      pending.delete(key)
      throw error
    },
  )
  pending.set(key, job)
  return job
}

export async function readCache<T>(key: string): Promise<T | undefined> {
  const db = await redis()
  if (!db) return readMemory<T>(key)
  try {
    const raw = await db.get(fullKey(key))
    if (raw === null) return undefined
    return unpack<T>(raw)
  } catch {
    return readMemory<T>(key)
  }
}

export async function remember<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const db = await redis()
  if (!db) return rememberLocal(key, ttlMs, load)
  try {
    const raw = await db.get(fullKey(key))
    if (raw !== null) return unpack<T>(raw)
  } catch {
    return rememberLocal(key, ttlMs, load)
  }
  const flight = pending.get(key)
  if (flight) return flight as Promise<T>
  const seen = await generation(key, db).catch(() => 0)
  const job = load().then(
    async (value) => {
      pending.delete(key)
      const now = await generation(key, db).catch(() => seen)
      if (now === seen) await db.set(fullKey(key), pack(value), { expiration: { type: 'PX', value: ttlMs } }).catch(() => {})
      return value
    },
    (error: unknown) => {
      pending.delete(key)
      throw error
    },
  )
  pending.set(key, job)
  return job
}

export async function writeCache(key: string, value: unknown, ttlMs: number) {
  pending.delete(key)
  const db = await redis()
  await bump(key, db).catch(() => {})
  if (!db) {
    memory.set(key, { value, expires: Date.now() + ttlMs })
    return
  }
  try {
    await db.set(fullKey(key), pack(value), { expiration: { type: 'PX', value: ttlMs } })
  } catch {
    memory.set(key, { value, expires: Date.now() + ttlMs })
  }
}

export async function dropCache(prefix: string) {
  for (const key of memory.keys()) {
    if (key === prefix || key.startsWith(prefix)) {
      memory.delete(key)
      localGen.set(key, (localGen.get(key) ?? 0) + 1)
    }
  }
  for (const key of pending.keys()) {
    if (key === prefix || key.startsWith(prefix)) pending.delete(key)
  }
  const db = await redis()
  if (!db) return
  try {
    for await (const batch of db.scanIterator({ MATCH: `${fullKey(prefix)}*`, COUNT: 100 })) {
      const keys = batch.filter((key) => {
        const logical = key.startsWith(keyPrefix()) ? key.slice(keyPrefix().length) : key
        return !logical.startsWith('gen:') && (logical === prefix || logical.startsWith(prefix))
      })
      for (const key of keys) {
        const logical = key.slice(keyPrefix().length)
        await db.incr(fullKey(`gen:${logical}`))
      }
      if (keys.length > 0) await db.del(keys)
    }
  } catch {
    return
  }
}
