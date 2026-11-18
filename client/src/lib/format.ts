export function money(amount: string | null, currency: string) {
  if (!amount) return '—'
  const value = Number(amount)
  if (Number.isNaN(value)) return amount
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: currency || 'IDR',
    maximumFractionDigits: 0,
  }).format(value)
}

export function when(iso: string | null) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function age(iso: string) {
  const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3600000))
  if (hours < 1) return 'baru saja'
  if (hours < 24) return `${hours} jam`
  const days = Math.round(hours / 24)
  return `${days} hari`
}
