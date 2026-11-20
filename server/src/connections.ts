import { probeBiteship } from './biteship.js'
import { probeDhl } from './dhl.js'
import { pakeet } from './pakeet.js'
import { probeShopify } from './shopify.js'

export interface ConnectionStatus {
  id: 'shopify' | 'indocolite' | 'biteship' | 'dhl'
  name: string
  ok: boolean
  detail: string
  balance: number | null
}

export async function connectionStatus(): Promise<ConnectionStatus[]> {
  return Promise.all([
    check('shopify', 'Shopify', async () => ({ detail: await probeShopify(), balance: null })),
    check('indocolite', 'Indocolite', probeIndocolite),
    check('biteship', 'Biteship', probeBiteship),
    check('dhl', 'DHL', async () => ({ detail: await probeDhl(), balance: null })),
  ])
}

async function probeIndocolite() {
  if (!process.env.PAKEET_API_TOKEN?.trim()) throw new Error('Kunci belum diisi')
  const body = await pakeet('/api/v1/wallet/balance')
  const data = body.data as { balance?: number } | undefined
  const balance = Number(data?.balance)
  return { detail: 'Aktif', balance: Number.isFinite(balance) ? balance : null }
}

async function check(
  id: ConnectionStatus['id'],
  name: string,
  probe: () => Promise<{ detail: string; balance: number | null }>,
): Promise<ConnectionStatus> {
  try {
    const result = await withTimeout(probe())
    return { id, name, ok: true, detail: result.detail, balance: result.balance }
  } catch (error) {
    return { id, name, ok: false, detail: safeDetail(error), balance: null }
  }
}

function withTimeout(work: Promise<{ detail: string; balance: number | null }>, ms = 12000) {
  return new Promise<{ detail: string; balance: number | null }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tidak menjawab')), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function safeDetail(error: unknown) {
  const message = error instanceof Error ? error.message : 'Tidak terjangkau'
  return message.replace(/bearer\s+\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Tidak terjangkau'
}
