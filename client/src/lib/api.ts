export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(body.error || 'Permintaan gagal')
  return body as T
}
