export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const fresh = new Map<string, { at: number; body: unknown }>()
const flights = new Map<string, Promise<unknown>>()
let epoch = 0
const FRESH_MS = 1_500

function methodOf(init?: RequestInit) {
  return (init?.method ?? 'GET').toUpperCase()
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new ApiError(body.error || 'Permintaan gagal', response.status)
  return body as T
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (methodOf(init) !== 'GET') {
    const result = await request<T>(path, init)
    epoch += 1
    fresh.clear()
    return result
  }
  const hit = fresh.get(path)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.body as T
  const flight = flights.get(path)
  if (flight) return flight as Promise<T>
  const seen = epoch
  const job = request<T>(path, init).then(
    (body) => {
      flights.delete(path)
      if (seen === epoch) fresh.set(path, { at: Date.now(), body })
      return body
    },
    (error: unknown) => {
      flights.delete(path)
      throw error
    },
  )
  flights.set(path, job)
  return job
}
