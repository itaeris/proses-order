<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronDownIcon, LogOutIcon, RefreshCwIcon, SearchIcon, SettingsIcon } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { toast } from 'vue-sonner'
import LoginPage, { type SessionUser } from '@/components/LoginPage.vue'
import OrderSheet from '@/components/OrderSheet.vue'
import RoutingPanel from '@/components/RoutingPanel.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
const shipOpen = ref(false)
const shipping = ref(false)
const shipResult = ref<Array<{ name: string; ok: boolean; awb: string | null; error: string | null }>>([])
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

const allSelected = computed(() => orders.value.length > 0 && orders.value.every((order) => selectedIds.value.includes(order.id)))
const shipOk = computed(() => shipResult.value.filter((row) => row.ok).length)

const manageCode = computed(() => {
  const match = routePath.value.match(/^\/manage-order\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : ''
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

async function load(silent = false) {
  const seq = ++loadSeq
  const params = new URLSearchParams()
  if (q.value.trim()) params.set('q', q.value.trim())
  if (channel.value !== 'all') params.set('channel', channel.value)
  if (warehouse.value !== 'all') params.set('warehouse', warehouse.value)
  if (awb.value !== 'all') params.set('awb', awb.value)
  if (overdueOnly.value) params.set('overdue', '1')
  if (unclaimedOnly.value) params.set('unclaimed', '1')
  params.set('view', view.value === 'routing' || view.value === 'settings' ? 'active' : view.value)
  if (!silent) loading.value = true
  const attempts = silent ? 1 : 3
  let lastError: unknown
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const data = await api<{ orders: OrderView[]; summary: Summary }>(`/api/orders?${params}`)
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

function askShip() {
  shipResult.value = []
  shipOpen.value = true
}

async function shipSelected() {
  shipping.value = true
  try {
    const data = await api<{ results: typeof shipResult.value }>('/api/orders/bulk-ship', {
      method: 'POST',
      body: JSON.stringify({ ids: selectedIds.value }),
    })
    shipResult.value = data.results
    selectedIds.value = []
    await load()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Pengiriman masal gagal')
    shipOpen.value = false
  } finally {
    shipping.value = false
  }
}

function openOrder(order: OrderView) {
  manageLoading.value = true
  managed.value = null
  go(`/manage-order/${encodeURIComponent(orderCode(order))}`)
}

function goHome() {
  go('/')
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
  if (known) {
    await new Promise((resolve) => window.setTimeout(resolve, 180))
    if (manageCode.value !== code) return
    managed.value = known
    manageLoading.value = false
    return
  }
  try {
    const data = await api<{ orders: OrderView[] }>(`/api/orders?q=${encodeURIComponent(code)}&view=all_active`)
    managed.value = data.orders.find((order) => orderCode(order).toLowerCase() === code.toLowerCase()) ?? null
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
  void load()
  void loadStatus()
}

function currentStep(order: OrderView) {
  if (order.channel === 'unassigned') return 'Pilih kurir'
  return order.channelSteps.find((step) => step.state === 'current')?.label ?? (order.channelDone ? 'Selesai' : '—')
}

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
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' })
  } catch {
    // Sesi lokal tetap ditutup.
  }
  window.clearInterval(poll)
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
        <div class="mr-auto">
          <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Gudang</p>
          <h1 class="text-lg font-semibold leading-none">Proses order</h1>
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
                @select="view = view === 'settings' ? 'active' : 'settings'"
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

    <main v-if="view === 'settings'" class="flex min-h-0 w-full flex-1 px-4 py-4">
      <SettingsPanel class="min-h-0 flex-1" :admin="user?.role === 'admin'" :account="user" @back="view = 'active'" @updated="user = $event" />
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
        <button type="button" class="cursor-pointer rounded-xl border bg-card px-3 py-3 text-left shadow-xs" @click="preset('unclaimed')">
          <p class="text-xs text-muted-foreground">Belum ada petugas</p>
          <Skeleton v-if="!summary" class="mt-2 h-8 w-12" />
          <p v-else class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.unclaimed }}</p>
          <p class="mt-1 text-[11px] leading-snug text-muted-foreground">Belum ada petugas yang mengerjakan.</p>
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
          <p v-else class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.byChannel.unassigned }}</p>
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
        <TabsList>
          <TabsTrigger value="active">Antrian {{ summary?.queue ?? '' }}</TabsTrigger>
          <TabsTrigger value="awaiting_awb">Menunggu resi</TabsTrigger>
          <TabsTrigger value="ready">Siap pickup</TabsTrigger>
          <TabsTrigger value="routing">Metode kirim</TabsTrigger>
        </TabsList>
      </Tabs>

      <div v-if="view === 'routing'" class="min-h-0 flex-1 overflow-auto">
        <RoutingPanel />
      </div>

      <section v-else class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
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
              <SelectItem value="print_label">Print label</SelectItem>
              <SelectItem value="packing">Packing</SelectItem>
              <SelectItem value="validasi_awb">Validasi resi</SelectItem>
              <SelectItem value="siap_pickup">Siap pickup</SelectItem>
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
          <Button size="sm" type="button" :disabled="shipping" @click="askShip">Buat resi</Button>
          <Button size="sm" variant="ghost" type="button" :disabled="shipping" @click="selectedIds = []">Batal</Button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
        <Table data-order-table class="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead class="w-10">
                <input
                  type="checkbox"
                  class="size-4 cursor-pointer accent-foreground"
                  :checked="allSelected"
                  aria-label="Pilih semua order"
                  @change="toggleAll"
                />
              </TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Pelanggan</TableHead>
              <TableHead>Kurir</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Langkah</TableHead>
              <TableHead>Resi</TableHead>
              <TableHead>Petugas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="index in loading ? 8 : 0" :key="`skeleton-${index}`">
              <TableCell><Skeleton class="size-4" /></TableCell>
              <TableCell><Skeleton class="h-4 w-24" /><Skeleton class="mt-2 h-3 w-16" /></TableCell>
              <TableCell><Skeleton class="h-4 w-32" /><Skeleton class="mt-2 h-3 w-20" /></TableCell>
              <TableCell><Skeleton class="h-4 w-28" /><Skeleton class="mt-2 h-3 w-20" /></TableCell>
              <TableCell><Skeleton class="h-5 w-20 rounded-full" /></TableCell>
              <TableCell><Skeleton class="h-4 w-24" /><Skeleton class="mt-2 h-3 w-16" /></TableCell>
              <TableCell><Skeleton class="h-4 w-20" /></TableCell>
              <TableCell><Skeleton class="h-4 w-16" /></TableCell>
            </TableRow>
            <TableRow
              v-for="order in loading ? [] : orders"
              :key="order.id"
              class="cursor-pointer"
              :class="order.overdue ? 'bg-red-50/80 hover:bg-red-50' : ''"
              @click="openOrder(order)"
            >
              <TableCell @click.stop>
                <input
                  type="checkbox"
                  class="size-4 cursor-pointer accent-foreground"
                  :checked="selectedIds.includes(order.id)"
                  :aria-label="`Pilih ${order.name}`"
                  @change="toggleOrder(order.id)"
                />
              </TableCell>
              <TableCell>
                <p class="font-mono font-bold">{{ order.name }}</p>
                <p class="text-xs text-muted-foreground">{{ age(order.createdAt) }} · {{ order.itemCount }} item</p>
              </TableCell>
              <TableCell>
                <p>{{ order.customerName }}</p>
                <p class="text-xs text-muted-foreground">{{ money(order.totalAmount, order.currency) }}</p>
              </TableCell>
              <TableCell>
                <p>{{ order.deliveryMethod || '—' }}</p>
                <p class="text-xs" :class="order.overdue ? 'text-destructive' : 'text-muted-foreground'">
                  {{ order.fulfillBy ? when(order.fulfillBy) : order.shippingCity || '' }}
                </p>
              </TableCell>
              <TableCell>
                <Badge variant="outline" :class="channelTone[order.channel]">{{ CHANNEL_LABEL[order.channel] }}</Badge>
              </TableCell>
              <TableCell>
                <p>{{ currentStep(order) }}</p>
                <p class="text-xs text-muted-foreground">{{ WAREHOUSE_LABEL[order.warehouseStep] }}</p>
              </TableCell>
              <TableCell>
                <p class="font-mono text-xs">{{ order.awbNumber || '—' }}</p>
                <p v-if="order.awbValidatedAt" class="text-xs text-emerald-800">Tervalidasi</p>
                <p v-else-if="order.awbNumber" class="text-xs text-amber-800">Belum dicek</p>
                <p v-else-if="order.problemNote" class="text-xs text-destructive">Ada catatan</p>
              </TableCell>
              <TableCell>{{ order.assignee || '—' }}</TableCell>
            </TableRow>
            <TableRow v-if="!loading && orders.length === 0">
              <TableCell colspan="8" class="py-10 text-center text-muted-foreground">
                Tidak ada order di tampilan ini.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        </div>
      </section>
    </main>
    <DialogRoot :open="shipOpen" @update:open="(open) => { if (!shipping) shipOpen = open }">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
        <DialogContent class="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-4 shadow-lg">
          <template v-if="shipResult.length === 0">
            <DialogTitle class="text-base font-semibold">Buat resi {{ selectedIds.length }} order?</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">
              Tarif termurah dipakai. Saldo Indocolite dan Biteship terpotong, dan akun DHL dibuatkan kiriman. Order tetap di antrian untuk cetak label, packing, lalu cek resi.
            </DialogDescription>
            <div class="mt-4 flex justify-end gap-2">
              <Button variant="outline" type="button" :disabled="shipping" @click="shipOpen = false">Batal</Button>
              <Button type="button" :disabled="shipping" @click="shipSelected">{{ shipping ? 'Membuat resi…' : 'Buat resi' }}</Button>
            </div>
          </template>
          <template v-else>
            <DialogTitle class="text-base font-semibold">{{ shipOk }} resi dibuat</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">
              Order yang berhasil tetap di antrian. Langkah berikutnya cetak label dan packing. Siap pickup menyala setelah resi dicek.
            </DialogDescription>
            <ul class="mt-3 max-h-64 space-y-2 overflow-auto text-sm">
              <li v-for="row in shipResult" :key="row.id">
                <p class="font-medium">{{ row.name }}</p>
                <p v-if="row.ok" class="font-mono text-xs text-muted-foreground">{{ row.awb || 'Resi sudah ada' }}</p>
                <p v-else class="text-xs text-rose-800">{{ row.error }}</p>
              </li>
            </ul>
            <div class="mt-4 flex justify-end">
              <Button type="button" @click="shipOpen = false">Tutup</Button>
            </div>
          </template>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
    </div>
  </div>
</template>
