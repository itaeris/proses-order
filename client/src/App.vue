<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ChevronDownIcon, LogOutIcon, RefreshCwIcon, SearchIcon, SettingsIcon } from '@lucide/vue'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { toast } from 'vue-sonner'
import BulkShipPanel from '@/components/BulkShipPanel.vue'
import LoginPage, { type SessionUser } from '@/components/LoginPage.vue'
import OrderSheet from '@/components/OrderSheet.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError, api } from '@/lib/api'
import { age, money, when } from '@/lib/format'
import {
  CHANNEL_LABEL,
  WAREHOUSE_LABEL,
  type ChannelId,
  type OrderView,
  type StatusInfo,
  type Summary,
} from '@/lib/types'

const orders = ref<OrderView[]>([])
const summary = ref<Summary | null>(null)
const status = ref<StatusInfo | null>(null)
const loading = ref(true)
const syncing = ref(false)
const selectedIds = ref<string[]>([])
const bulkJob = ref<BulkJob>('')
const bulkChannel = ref<'indocolite' | 'biteship' | 'dhl' | null>(null)
const bulkSnapshot = ref<OrderView[]>([])
type ShipStatus = 'created' | 'processing' | 'failed'
interface ShipRow {
  id: string
  name: string
  channel: ChannelId
  status: ShipStatus
  awb: string | null
  courier: string | null
  service: string | null
  cost: number | null
  pickup: string | null
  detail: string
}

type BulkJob = '' | 'ship' | 'check' | 'pickup' | 'validate'

const shipResult = ref<ShipRow[]>([])

const BULK_KEY = 'proses-bulk'

function readBulk() {
  try {
    const raw = localStorage.getItem(BULK_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as { channel?: 'indocolite' | 'biteship' | 'dhl'; ids?: string[]; orders?: OrderView[]; results?: ShipRow[] }
    if (saved.channel !== 'indocolite' && saved.channel !== 'biteship' && saved.channel !== 'dhl') return null
    if (!Array.isArray(saved.orders) || !Array.isArray(saved.results) || !Array.isArray(saved.ids)) return null
    return { channel: saved.channel, ids: saved.ids, orders: saved.orders, results: saved.results }
  } catch {
    return null
  }
}

function saveBulk() {
  if (!bulkChannel.value || bulkSnapshot.value.length === 0) return
  localStorage.setItem(BULK_KEY, JSON.stringify({
    channel: bulkChannel.value,
    ids: bulkSnapshot.value.map((order) => order.id),
    orders: bulkSnapshot.value,
    results: shipResult.value,
  }))
}

function sameIds(left: string[], right: string[]) {
  return [...left].sort().join() === [...right].sort().join()
}

const savedBulk = readBulk()
if (savedBulk) {
  bulkChannel.value = savedBulk.channel
  bulkSnapshot.value = savedBulk.orders
  shipResult.value = savedBulk.results
  if (window.location.pathname.startsWith('/pengiriman-masal')) selectedIds.value = savedBulk.ids
}
const q = ref('')
const channel = ref('all')
const warehouse = ref('all')
const awb = ref('all')
const overdueOnly = ref(false)
const unclaimedOnly = ref(false)
const view = ref('active')
const user = ref<SessionUser | null>(null)
const booting = ref(true)
const routePath = ref(window.location.pathname)
const managed = ref<OrderView | null>(null)
const manageLoading = ref(false)

const queueTabs = [
  { value: 'active', label: 'Antrian' },
  { value: 'awaiting_awb', label: 'Menunggu resi' },
  { value: 'ready', label: 'Siap pickup' },
]
const allSelected = computed(() => orders.value.length > 0 && orders.value.every((order) => selectedIds.value.includes(order.id)))
const someSelected = computed(() => selectedIds.value.length > 0 && !allSelected.value)

const manageCode = computed(() => {
  const match = routePath.value.match(/^\/manage-order\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : ''
})

const settingsOpen = computed(() => /^\/settings\/?$/.test(routePath.value))
const bulkOpen = computed(() => /^\/pengiriman-masal\/?$/.test(routePath.value))
const filteredCourier = computed(() => (channel.value === 'indocolite' || channel.value === 'biteship' || channel.value === 'dhl' ? channel.value : null))
const bulkOrders = computed(() => {
  const fresh = new Map(orders.value.map((order) => [order.id, order]))
  return bulkSnapshot.value.map((order) => {
    const next = fresh.get(order.id)
    if (!next) return order
    if (order.awbValidatedAt && !next.awbValidatedAt) return order
    return next
  })
})

const initials = computed(() => {
  const parts = (user.value?.name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
})

const channelTone: Record<ChannelId, string> = {
  indocolite: 'bg-sky-100 text-sky-950',
  biteship: 'bg-violet-100 text-violet-950',
  dhl: 'bg-amber-100 text-amber-950',
  unassigned: 'bg-rose-100 text-rose-950',
}

let timer = 0
let loadSeq = 0
watch([q, channel, warehouse, awb, overdueOnly, unclaimedOnly, view], () => {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void load(), 200)
})

async function loadStatus() {
  status.value = await api<StatusInfo>('/api/status')
}

async function load(silent = false, fresh = false) {
  const seq = ++loadSeq
  const params = new URLSearchParams()
  if (q.value.trim()) params.set('q', q.value.trim())
  if (channel.value !== 'all') params.set('channel', channel.value)
  if (warehouse.value !== 'all') params.set('warehouse', warehouse.value)
  if (awb.value !== 'all') params.set('awb', awb.value)
  if (overdueOnly.value) params.set('overdue', '1')
  if (unclaimedOnly.value) params.set('unclaimed', '1')
  params.set('view', view.value)
  if (!silent) loading.value = true
  const attempts = silent ? 1 : 3
  let lastError: unknown
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const data = await api<{ orders: OrderView[]; summary: Summary }>(`/api/orders?${params}`, undefined, { fresh })
        if (seq !== loadSeq) return
        orders.value = data.orders
        summary.value = data.summary
        const code = manageCode.value.toLowerCase()
        if (code && managed.value) {
          const fresh = data.orders.find((order) => order.name.replace(/^#/, '').toLowerCase() === code)
          if (fresh) managed.value = fresh
        }
        return
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          user.value = null
          return
        }
        lastError = error
        if (seq !== loadSeq || attempt === attempts - 1) break
        await new Promise((resolve) => window.setTimeout(resolve, 600 * (attempt + 1)))
      }
    }
    if (seq !== loadSeq) return
    toast.error(lastError instanceof Error ? lastError.message : 'Gagal memuat antrian')
  } finally {
    if (!silent && seq === loadSeq) loading.value = false
  }
}

async function refresh() {
  syncing.value = true
  try {
    if (status.value?.shopifyConfigured) {
      await api('/api/sync', { method: 'POST' })
      toast.success('Order Shopify diperbarui')
    }
    await Promise.all([load(), loadStatus()])
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Gagal menyegarkan')
    await loadStatus()
  } finally {
    syncing.value = false
  }
}

function preset(next: string) {
  overdueOnly.value = next === 'overdue'
  unclaimedOnly.value = next === 'unclaimed'
  channel.value = next === 'unassigned' ? 'unassigned' : 'all'
  warehouse.value = 'all'
  awb.value = 'all'
  view.value = next === 'ready' ? 'ready' : next === 'awb' ? 'awaiting_awb' : 'active'
}

function orderCode(order: OrderView) {
  return order.name.replace(/^#/, '')
}

function go(url: string) {
  if (window.location.pathname === url) return
  history.pushState({}, '', url)
  routePath.value = url
}

function toggleOrder(id: string) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((item) => item !== id)
    : [...selectedIds.value, id]
}

function toggleAll() {
  selectedIds.value = allSelected.value ? [] : orders.value.map((order) => order.id)
}

async function openBulk() {
  if (!filteredCourier.value || selectedIds.value.length === 0) return
  const ids = [...selectedIds.value]
  const previous = readBulk()
  const same = previous?.channel === filteredCourier.value && sameIds(previous.ids, ids)
  bulkChannel.value = filteredCourier.value
  if (!same) shipResult.value = []
  try {
    await api('/api/orders/bulk-claim', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
    await load(true, true)
    const fresh = new Map(orders.value.map((order) => [order.id, order]))
    const kept = same ? previous.orders : []
    bulkSnapshot.value = ids.map((id) => fresh.get(id) ?? kept.find((order) => order.id === id)).filter((order): order is OrderView => !!order)
    saveBulk()
    go('/pengiriman-masal')
    await Promise.all([refreshHistory(), refreshBulkOrders()])
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Petugas gagal dicatat')
  }
}

function keepBulkOrders(next: OrderView[]) {
  const fresh = new Map(next.map((order) => [order.id, order]))
  bulkSnapshot.value = bulkSnapshot.value.map((order) => fresh.get(order.id) ?? order)
  saveBulk()
}

async function refreshBulkOrders() {
  if (bulkSnapshot.value.length === 0) return
  const data = await api<{ orders: OrderView[] }>('/api/orders?view=all_active', undefined, { fresh: true })
  keepBulkOrders(data.orders)
}

async function refreshHistory() {
  const ids = bulkSnapshot.value.map((order) => order.id)
  if (ids.length === 0) return
  const data = await api<{ results: ShipRow[] }>('/api/orders/bulk-history', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
  shipResult.value = data.results.map((row) => {
    const previous = shipResult.value.find((item) => item.id === row.id)
    return {
      ...row,
      courier: row.courier ?? previous?.courier ?? null,
      service: row.service ?? previous?.service ?? null,
      cost: row.cost ?? previous?.cost ?? null,
      pickup: row.pickup ?? previous?.pickup ?? null,
    }
  })
  saveBulk()
}

function bulkIds() {
  const shown = bulkOrders.value.map((order) => order.id)
  return shown.length > 0 ? shown : selectedIds.value
}

async function shipSelected() {
  await runBulk('ship', '/api/orders/bulk-ship', { ids: bulkIds() }, 'Pengiriman masal gagal')
}

async function checkSelected() {
  await runBulk('check', '/api/orders/bulk-status', { ids: bulkIds() }, 'Status resi gagal dicek')
}

async function pickupSelected(input: { date: string; time: string; vehicle: string }) {
  await runBulk('pickup', '/api/orders/bulk-pickup', { ids: bulkIds(), ...input }, 'Pickup gagal diajukan')
}

async function validateSelected(awb: string) {
  bulkJob.value = 'validate'
  try {
    const data = await api<{ orders: OrderView[] }>('/api/orders/bulk-validate', {
      method: 'POST',
      body: JSON.stringify({ ids: bulkIds(), awb }),
    })
    keepBulkOrders(data.orders)
    await load(true, true)
    toast.success(`Resi ${awb} cocok. Order siap pickup.`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Resi gagal dicek')
  } finally {
    bulkJob.value = ''
  }
}

async function runBulk(job: BulkJob, path: string, body: unknown, fallback: string) {
  bulkJob.value = job
  if (job === 'check') toast.message('Mengecek nomor resi…')
  try {
    const data = await api<{ results: ShipRow[] }>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (job === 'check') reportCheck(data.results)
    if (job === 'pickup') reportPickup(data.results)
    shipResult.value = data.results.map((row) => {
      const previous = shipResult.value.find((item) => item.id === row.id)
      return {
        ...row,
        courier: row.courier ?? previous?.courier ?? null,
        service: row.service ?? previous?.service ?? null,
        cost: row.cost ?? previous?.cost ?? null,
        pickup: row.pickup ?? previous?.pickup ?? null,
      }
    })
    await load(true, true)
    await refreshBulkOrders()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : fallback)
  } finally {
    bulkJob.value = ''
  }
}

function reportPickup(rows: ShipRow[]) {
  const ready = rows.filter((row) => row.awb)
  const booked = rows.filter((row) => row.pickup)
  const failed = rows.filter((row) => row.status === 'failed')
  if (ready.length > 0) {
    toast.success(ready.map((row) => `${row.name} ${row.awb}`).join(', '))
    return
  }
  if (booked.length > 0) {
    toast.success('Pickup diajukan. Tekan Cek status untuk nomor resi.')
    return
  }
  toast.error(failed[0]?.detail || 'Pickup gagal diajukan')
}

function reportCheck(rows: ShipRow[]) {
  const ready = rows.filter((row) => row.awb)
  const failed = rows.filter((row) => row.status === 'failed')
  if (ready.length > 0) {
    toast.success(ready.map((row) => `${row.name} ${row.awb}`).join(', '))
    return
  }
  if (failed.length > 0 && failed.length === rows.length) {
    toast.error(failed[0]?.detail || 'Status resi gagal dicek')
    return
  }
  toast.info('Nomor resi belum keluar')
}

function openOrder(order: OrderView) {
  manageLoading.value = true
  managed.value = null
  go(`/manage-order/${encodeURIComponent(orderCode(order))}`)
}

function goHome() {
  go('/')
}

let queuePull = 0

async function pullQueue() {
  const token = ++queuePull
  syncing.value = true
  void load(true, true)
  let signedOut = false
  try {
    if (status.value?.shopifyConfigured) await api('/api/sync', { method: 'POST' })
  } catch (error) {
    signedOut = error instanceof ApiError && error.status === 401
  }
  if (signedOut) {
    user.value = null
    syncing.value = false
    return
  }
  if (token !== queuePull) return
  try {
    await Promise.all([load(true, true), loadStatus()])
  } finally {
    if (token === queuePull) syncing.value = false
  }
}

function openSettings() {
  go(settingsOpen.value ? '/' : '/settings')
}

async function openManaged() {
  const code = manageCode.value
  if (!code || !user.value) return
  manageLoading.value = true
  managed.value = null
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  if (manageCode.value !== code) return
  const known = orders.value.find((order) => orderCode(order).toLowerCase() === code.toLowerCase())
  try {
    const data = await api<{ orders: OrderView[] }>(`/api/orders?q=${encodeURIComponent(code)}&view=all_active`, undefined, { fresh: true })
    if (manageCode.value !== code) return
    managed.value = data.orders.find((order) => orderCode(order).toLowerCase() === code.toLowerCase()) ?? known ?? null
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) user.value = null
    managed.value = null
  } finally {
    manageLoading.value = false
  }
}

function onChanged(order: OrderView) {
  managed.value = order
  const index = orders.value.findIndex((item) => item.id === order.id)
  if (index >= 0) orders.value[index] = order
  void load(true, true)
  void loadStatus()
}

function currentStep(order: OrderView) {
  return WAREHOUSE_LABEL[order.warehouseStep]
}

type SortKey = 'order' | 'entered' | 'customer' | 'courier' | 'channel' | 'step' | 'awb' | 'assignee'

const sortColumns: { key: SortKey; label: string }[] = [
  { key: 'order', label: 'Order' },
  { key: 'entered', label: 'Masuk' },
  { key: 'customer', label: 'Pelanggan' },
  { key: 'courier', label: 'Kurir' },
  { key: 'channel', label: 'Channel' },
  { key: 'step', label: 'Langkah' },
  { key: 'awb', label: 'Resi' },
  { key: 'assignee', label: 'Petugas' },
]
const sortKey = ref<SortKey | ''>('')
const sortDir = ref<'asc' | 'desc'>('asc')

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortKey.value = key
  sortDir.value = key === 'entered' ? 'desc' : 'asc'
}

function sortText(order: OrderView) {
  if (sortKey.value === 'order') return order.name
  if (sortKey.value === 'customer') return order.customerName
  if (sortKey.value === 'courier') return order.deliveryMethod ?? ''
  if (sortKey.value === 'channel') return CHANNEL_LABEL[order.channel]
  if (sortKey.value === 'step') return currentStep(order)
  if (sortKey.value === 'awb') return order.awbNumber ?? ''
  return order.assignee ?? ''
}

const sortedOrders = computed(() => {
  if (!sortKey.value) return orders.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...orders.value].sort((a, b) => {
    if (sortKey.value === 'entered') {
      const leftTime = new Date(a.createdAt).getTime()
      const rightTime = new Date(b.createdAt).getTime()
      const badLeft = Number.isNaN(leftTime)
      const badRight = Number.isNaN(rightTime)
      if (badLeft || badRight) {
        if (badLeft && badRight) return 0
        return badLeft ? 1 : -1
      }
      return (leftTime - rightTime) * dir
    }
    const left = sortText(a).trim()
    const right = sortText(b).trim()
    const emptyLeft = left === '' || left === '—'
    const emptyRight = right === '' || right === '—'
    if (emptyLeft || emptyRight) {
      if (emptyLeft && emptyRight) return 0
      return emptyLeft ? 1 : -1
    }
    return left.localeCompare(right, 'id', { numeric: true, sensitivity: 'base' }) * dir
  })
})

let poll = 0

function startPolling() {
  window.clearInterval(poll)
  poll = window.setInterval(() => {
    void load(true)
    void loadStatus()
  }, 20000)
}

async function enter(account: SessionUser) {
  user.value = account
  await Promise.all([load(), loadStatus()])
  startPolling()
  if (bulkOpen.value && bulkSnapshot.value.length > 0) {
    try {
      await Promise.all([refreshHistory(), refreshBulkOrders()])
    } catch {
      // Riwayat lokal tetap ditampilkan.
    }
  }
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' })
  } catch {
    // Sesi lokal tetap ditutup.
  }
  window.clearInterval(poll)
  localStorage.removeItem(BULK_KEY)
  user.value = null
  view.value = 'active'
}

watch(orders, (rows) => {
  const ids = new Set(rows.map((order) => order.id))
  selectedIds.value = selectedIds.value.filter((id) => ids.has(id))
})

watch(manageCode, () => {
  void openManaged()
})

watch(routePath, (path, previous) => {
  if (!previous || !user.value) return
  const home = path === '/' || path === ''
  const leftDetail = previous.startsWith('/manage-order') || /^\/settings\/?$/.test(previous)
  if (home && leftDetail) void pullQueue()
})

function onPopState() {
  routePath.value = window.location.pathname
}

onMounted(async () => {
  window.addEventListener('popstate', onPopState)
  try {
    const account = await api<SessionUser>('/api/me')
    user.value = account
    if (manageCode.value) manageLoading.value = true
    booting.value = false
    await nextTick()
    await enter(account)
    if (manageCode.value) await openManaged()
  } catch {
    user.value = null
  } finally {
    booting.value = false
  }
})
onUnmounted(() => {
  window.clearInterval(poll)
  window.removeEventListener('popstate', onPopState)
})
</script>

<template>
  <LoginPage v-if="!booting && !user" @ready="enter" />
  <div v-else class="flex h-dvh overflow-hidden">
    <Toaster position="top-right" />
    <div v-if="booting" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading...</div>
    <div v-else class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
    <header class="shrink-0 border-b bg-background">
      <div class="flex flex-wrap items-center gap-3 px-4 py-3">
        <div class="mr-auto flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" class="size-9" />
          <div>
            <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Gudang</p>
            <h1 class="text-lg font-semibold leading-none">Proses order</h1>
          </div>
        </div>
        <p v-if="status?.lastSyncAt" class="text-xs text-muted-foreground">
          Sync {{ when(status.lastSyncAt) }}
        </p>
        <Button size="sm" variant="outline" type="button" :disabled="syncing" @click="refresh">
          <RefreshCwIcon :class="syncing ? 'animate-spin' : ''" />
          Segarkan
        </Button>
        <DropdownMenuRoot>
          <DropdownMenuTrigger
            class="flex cursor-pointer items-center gap-2 rounded-full border bg-card py-1 pr-2 pl-1 text-sm outline-none hover:bg-muted"
          >
            <span class="flex size-7 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
              {{ initials }}
            </span>
            <span class="max-w-32 truncate font-medium">{{ user?.name }}</span>
            <ChevronDownIcon class="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              align="end"
              :side-offset="8"
              class="z-50 min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
            >
              <DropdownMenuItem
                class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted"
                @select="openSettings"
              >
                <SettingsIcon class="size-4" />
                Pengaturan
              </DropdownMenuItem>
              <DropdownMenuItem
                class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted"
                @select="logout"
              >
                <LogOutIcon class="size-4" />
                Keluar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>
    </header>

    <main v-if="settingsOpen" class="flex min-h-0 w-full flex-1 px-4 py-4">
      <SettingsPanel class="min-h-0 flex-1" :admin="user?.role === 'admin'" :account="user" @back="goHome" @updated="user = $event" />
    </main>

    <main v-else-if="bulkOpen" class="flex min-h-0 w-full flex-1 px-4 py-4">
      <BulkShipPanel
        v-if="bulkChannel"
        class="min-h-0 flex-1"
        :channel="bulkChannel"
        :orders="bulkOrders"
        :results="shipResult"
        :job="bulkJob"
        @back="goHome"
        @ship="shipSelected"
        @check="checkSelected"
        @pickup="pickupSelected"
        @validate="validateSelected"
      />
      <div v-else class="space-y-3">
        <Button variant="outline" size="sm" type="button" class="cursor-pointer" @click="goHome">Antrian</Button>
        <p class="text-sm text-muted-foreground">Filter Indocolite, Biteship, atau DHL, centang ordernya, lalu buka pengiriman masal.</p>
      </div>
    </main>

    <main v-else-if="manageCode" class="flex min-h-0 w-full flex-1 flex-col">
      <div v-if="manageLoading && !managed" class="flex min-h-0 flex-1 flex-col bg-background">
        <header class="shrink-0 border-b px-4 py-3">
          <div class="flex flex-wrap items-center gap-3">
            <Skeleton class="h-8 w-24" />
            <Skeleton class="h-5 min-w-0 flex-1" />
            <Skeleton class="h-6 w-20 rounded-full" />
            <Skeleton class="h-8 w-20" />
          </div>
        </header>
        <div class="grid items-start gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div class="space-y-4">
            <div class="grid gap-4 md:grid-cols-2">
              <Skeleton class="h-24 rounded-xl" />
              <Skeleton class="h-24 rounded-xl" />
            </div>
            <Skeleton class="h-52 rounded-xl" />
            <Skeleton class="h-40 rounded-xl" />
            <Skeleton class="h-36 rounded-xl" />
          </div>
          <div class="space-y-4">
            <Skeleton class="h-52 rounded-xl" />
            <Skeleton class="h-36 rounded-xl" />
          </div>
        </div>
      </div>
      <div v-else-if="!managed" class="space-y-3 p-4">
        <Button variant="outline" size="sm" type="button" @click="goHome">Antrian</Button>
        <p class="text-sm text-muted-foreground">Order {{ manageCode }} tidak ditemukan.</p>
      </div>
      <OrderSheet v-else :order="managed" @close="goHome" @changed="onChanged" />
    </main>

    <main v-else class="flex min-h-0 w-full flex-1 flex-col gap-4 px-4 py-4">
      <div v-if="status?.usingSample" class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        Shopify belum terhubung. Ini data contoh. Isi <span class="font-mono">.env</span> lalu segarkan untuk menarik order sungguhan.
      </div>
      <div v-if="status?.lastError" class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {{ status.lastError }}
      </div>

      <p class="shrink-0 text-xs leading-relaxed text-muted-foreground">
        Antrian ini mengikuti filter order di Shopify:
        <span class="font-medium text-foreground">Fulfillment Unfulfilled</span>
        (termasuk Partial),
        <span class="font-medium text-foreground">Order bukan Canceled</span>,
        <span class="font-medium text-foreground">Payment Paid</span>.
      </p>

      <section class="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-5">
        <button type="button" class="cursor-pointer rounded-xl border bg-card px-3 py-3 text-left shadow-xs" @click="preset('queue')">
          <p class="text-xs text-muted-foreground">Orderan yang masuk</p>
          <Skeleton v-if="!summary" class="mt-2 h-8 w-12" />
          <p v-else class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.queue }}</p>
          <p class="mt-1 text-[11px] leading-snug text-muted-foreground">Order yang belum siap pickup.</p>
        </button>
        <button type="button" class="cursor-pointer rounded-xl border bg-card px-3 py-3 text-left shadow-xs" @click="preset('awb')">
          <p class="text-xs text-muted-foreground">Menunggu resi</p>
          <Skeleton v-if="!summary" class="mt-2 h-8 w-12" />
          <p v-else class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.awaitingAwb }}</p>
          <p class="mt-1 text-[11px] leading-snug text-muted-foreground">Sudah packing, nomor resi belum dicek.</p>
        </button>
        <button type="button" class="cursor-pointer rounded-xl border bg-card px-3 py-3 text-left shadow-xs" @click="preset('overdue')">
          <p class="text-xs text-muted-foreground">Terlambat</p>
          <Skeleton v-if="!summary" class="mt-2 h-8 w-12" />
          <p v-else class="mt-1 text-2xl font-semibold tabular-nums text-destructive">{{ summary.overdue }}</p>
          <p class="mt-1 text-[11px] leading-snug text-muted-foreground">Lewat batas kirim, atau sudah lebih dari 24 jam.</p>
        </button>
        <button type="button" class="cursor-pointer rounded-xl border bg-card px-3 py-3 text-left shadow-xs" @click="preset('unassigned')">
          <p class="text-xs text-muted-foreground">Kurir belum dipilih</p>
          <Skeleton v-if="!summary" class="mt-2 h-8 w-12" />
          <p v-else class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.unassigned }}</p>
          <p class="mt-1 text-[11px] leading-snug text-muted-foreground">Metode kirim belum masuk Indocolite, Biteship, atau DHL.</p>
        </button>
        <button type="button" class="cursor-pointer rounded-xl border bg-card px-3 py-3 text-left shadow-xs" @click="preset('ready')">
          <p class="text-xs text-muted-foreground">Siap pickup hari ini</p>
          <Skeleton v-if="!summary" class="mt-2 h-8 w-12" />
          <p v-else class="mt-1 text-2xl font-semibold tabular-nums text-emerald-800">{{ summary.readyToday }}</p>
          <p class="mt-1 text-[11px] leading-snug text-muted-foreground">Resi sudah valid. Kurir boleh ambil hari ini.</p>
        </button>
      </section>

      <Tabs class="shrink-0" :model-value="view" @update:model-value="view = String($event)">
        <TabsList class="h-auto gap-2 bg-transparent p-0">
          <TabsTrigger
            v-for="tab in queueTabs"
            :key="tab.value"
            :value="tab.value"
            class="h-8 flex-none cursor-pointer rounded-md border border-border bg-background px-3 text-foreground shadow-xs hover:bg-muted data-active:border-primary data-active:bg-primary data-active:text-primary-foreground data-active:shadow-none"
          >
            {{ tab.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
        <div class="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
          <div class="relative min-w-56 flex-1">
            <SearchIcon class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="q" placeholder="Cari nomor order, pelanggan, atau resi" class="pl-8" />
          </div>
          <Select v-model="channel">
            <SelectTrigger class="min-w-40 bg-background">
              <SelectValue placeholder="Semua ekspedisi" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="all">Semua ekspedisi</SelectItem>
              <SelectItem value="indocolite">Indocolite {{ summary?.byChannel.indocolite ?? 0 }}</SelectItem>
              <SelectItem value="biteship">Biteship {{ summary?.byChannel.biteship ?? 0 }}</SelectItem>
              <SelectItem value="dhl">DHL {{ summary?.byChannel.dhl ?? 0 }}</SelectItem>
              <SelectItem value="unassigned">Perlu dipilih</SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="warehouse">
            <SelectTrigger class="min-w-40 bg-background">
              <SelectValue placeholder="Semua proses" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="all">Semua proses</SelectItem>
              <SelectItem v-for="(label, id) in WAREHOUSE_LABEL" :key="id" :value="id">{{ label }}</SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="awb">
            <SelectTrigger class="min-w-40 bg-background">
              <SelectValue placeholder="Semua resi" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="all">Semua resi</SelectItem>
              <SelectItem value="missing">Belum ada resi</SelectItem>
              <SelectItem value="pending">Belum divalidasi</SelectItem>
              <SelectItem value="validated">Tervalidasi</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" type="button" :variant="overdueOnly ? 'default' : 'outline'" @click="overdueOnly = !overdueOnly">
            Terlambat
          </Button>
        </div>
        <div v-if="selectedIds.length" class="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
          <p class="mr-auto text-sm font-medium">{{ selectedIds.length }} dipilih</p>
          <Button v-if="filteredCourier" size="sm" type="button" class="cursor-pointer" @click="openBulk">Pengiriman masal</Button>
          <p v-else class="text-xs text-muted-foreground">Filter Indocolite, Biteship, atau DHL dulu.</p>
          <Button size="sm" variant="ghost" type="button" class="cursor-pointer" @click="selectedIds = []">Batal</Button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
        <Table data-order-table class="min-w-[64rem] table-fixed">
          <colgroup>
            <col class="w-[4%]" />
            <col class="w-[10%]" />
            <col class="w-[11%]" />
            <col class="w-[16%]" />
            <col class="w-[20%]" />
            <col class="w-[9%]" />
            <col class="w-[11%]" />
            <col class="w-[10%]" />
            <col class="w-[9%]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead class="w-10">
                <Checkbox
                  :checked="allSelected"
                  :indeterminate="someSelected"
                  label="Pilih semua order"
                  @toggle="toggleAll"
                />
              </TableHead>
              <TableHead v-for="column in sortColumns" :key="column.key">
                <button
                  type="button"
                  class="inline-flex cursor-pointer items-center gap-1"
                  :aria-sort="sortKey === column.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'"
                  @click="toggleSort(column.key)"
                >
                  {{ column.label }}
                  <ArrowUpIcon v-if="sortKey === column.key && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDownIcon v-else-if="sortKey === column.key && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDownIcon v-else class="size-3.5 text-muted-foreground" />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="index in loading ? 8 : 0" :key="`skeleton-${index}`">
              <TableCell><Skeleton class="size-4" /></TableCell>
              <TableCell><Skeleton class="h-4 w-24" /><Skeleton class="mt-2 h-3 w-16" /></TableCell>
              <TableCell><Skeleton class="h-4 w-24" /><Skeleton class="mt-2 h-3 w-16" /></TableCell>
              <TableCell><Skeleton class="h-4 w-32" /><Skeleton class="mt-2 h-3 w-20" /></TableCell>
              <TableCell><Skeleton class="h-4 w-28" /><Skeleton class="mt-2 h-3 w-20" /></TableCell>
              <TableCell><Skeleton class="h-5 w-20 rounded-full" /></TableCell>
              <TableCell><Skeleton class="h-4 w-24" /><Skeleton class="mt-2 h-3 w-16" /></TableCell>
              <TableCell><Skeleton class="h-4 w-20" /></TableCell>
              <TableCell><Skeleton class="h-4 w-16" /></TableCell>
            </TableRow>
            <TableRow
              v-for="order in loading ? [] : sortedOrders"
              :key="order.id"
              class="cursor-pointer"
              :class="order.overdue ? 'bg-red-50/80 hover:bg-red-50' : ''"
              @click="openOrder(order)"
            >
              <TableCell @click.stop>
                <Checkbox
                  :checked="selectedIds.includes(order.id)"
                  :label="`Pilih ${order.name}`"
                  @toggle="toggleOrder(order.id)"
                />
              </TableCell>
              <TableCell class="overflow-hidden">
                <p class="truncate font-mono font-bold">{{ order.name }}</p>
                <p class="truncate text-xs text-muted-foreground">{{ order.itemCount }} item</p>
              </TableCell>
              <TableCell class="overflow-hidden">
                <p class="truncate">{{ when(order.createdAt) }}</p>
                <p class="truncate text-xs text-muted-foreground">{{ age(order.createdAt) }}</p>
              </TableCell>
              <TableCell class="overflow-hidden">
                <p class="truncate" :title="order.customerName || undefined">{{ order.customerName }}</p>
                <p class="truncate text-xs text-muted-foreground">{{ money(order.totalAmount, order.currency) }}</p>
              </TableCell>
              <TableCell class="overflow-hidden">
                <p class="truncate" :title="order.deliveryMethod || undefined">{{ order.deliveryMethod || '—' }}</p>
                <p class="truncate text-xs" :class="order.overdue ? 'text-destructive' : 'text-muted-foreground'">
                  {{ order.fulfillBy ? when(order.fulfillBy) : order.shippingCity || '' }}
                </p>
              </TableCell>
              <TableCell class="overflow-hidden">
                <Badge variant="outline" :class="channelTone[order.channel]">{{ CHANNEL_LABEL[order.channel] }}</Badge>
              </TableCell>
              <TableCell class="overflow-hidden">
                <p class="truncate" :title="currentStep(order)">{{ currentStep(order) }}</p>
              </TableCell>
              <TableCell class="overflow-hidden">
                <p class="truncate font-mono text-xs" :title="order.awbNumber || undefined">{{ order.awbNumber || '—' }}</p>
                <p v-if="order.awbValidatedAt" class="truncate text-xs text-emerald-800">Tervalidasi</p>
                <p v-else-if="order.awbNumber" class="truncate text-xs text-amber-800">Belum dicek</p>
                <p v-else-if="order.problemNote" class="truncate text-xs text-destructive">Ada catatan</p>
              </TableCell>
              <TableCell class="overflow-hidden">
                <p class="truncate" :title="order.assignee || undefined">{{ order.assignee || '—' }}</p>
              </TableCell>
            </TableRow>
            <TableRow v-if="!loading && orders.length === 0">
              <TableCell colspan="9" class="py-10 text-center text-muted-foreground">
                Tidak ada order di tampilan ini.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        </div>
      </section>
    </main>
    </div>
  </div>
</template>
