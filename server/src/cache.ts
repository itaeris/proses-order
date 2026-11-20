type Box = { value: unknown; expires: number }

const store = new Map<string, Box>()
const pending = new Map<string, Promise<unknown>>()
const generation = new Map<string, number>()

export function readCache<T>(key: string): T | undefined {
  const hit = store.get(key)
  if (!hit || hit.expires <= Date.now()) return undefined
  return hit.value as T
}

export async function remember<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expires > now) return hit.value as T
  const flight = pending.get(key)
  if (flight) return flight as Promise<T>
  const seen = generation.get(key) ?? 0
  const job = load().then(
    (value) => {
      pending.delete(key)
      if ((generation.get(key) ?? 0) === seen) store.set(key, { value, expires: Date.now() + ttlMs })
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

export function writeCache(key: string, value: unknown, ttlMs: number) {
  generation.set(key, (generation.get(key) ?? 0) + 1)
  pending.delete(key)
  store.set(key, { value, expires: Date.now() + ttlMs })
}

export function dropCache(prefix: string) {
  for (const key of store.keys()) {
    if (key === prefix || key.startsWith(prefix)) {
      store.delete(key)
      generation.set(key, (generation.get(key) ?? 0) + 1)
    }
  }
  for (const key of pending.keys()) {
    if (key === prefix || key.startsWith(prefix)) pending.delete(key)
  }
}
