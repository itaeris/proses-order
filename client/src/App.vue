<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RefreshCwIcon, SearchIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import OrderSheet from '@/components/OrderSheet.vue'
import RoutingPanel from '@/components/RoutingPanel.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
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
const q = ref('')
const channel = ref('all')
const warehouse = ref('all')
const awb = ref('all')
const overdueOnly = ref(false)
const unclaimedOnly = ref(false)
const view = ref('active')
const selectedId = ref<string | null>(null)
const pinned = ref<OrderView | null>(null)
const staff = ref(localStorage.getItem('proses-order-staff') ?? '')

const selected = computed(() => {
  if (!selectedId.value) return null
  return orders.value.find((order) => order.id === selectedId.value) ?? pinned.value
})

const channelTone: Record<ChannelId, string> = {
  indocolite: 'bg-sky-100 text-sky-950',
  biteship: 'bg-violet-100 text-violet-950',
  dhl: 'bg-amber-100 text-amber-950',
  unassigned: 'bg-rose-100 text-rose-950',
}

watch(staff, (value) => localStorage.setItem('proses-order-staff', value))

let timer = 0
watch([q, channel, warehouse, awb, overdueOnly, unclaimedOnly, view], () => {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void load(), 200)
})

async function loadStatus() {
  status.value = await api<StatusInfo>('/api/status')
}

async function load(silent = false) {
  const params = new URLSearchParams()
  if (q.value.trim()) params.set('q', q.value.trim())
  if (channel.value !== 'all') params.set('channel', channel.value)
  if (warehouse.value !== 'all') params.set('warehouse', warehouse.value)
  if (awb.value !== 'all') params.set('awb', awb.value)
  if (overdueOnly.value) params.set('overdue', '1')
  if (unclaimedOnly.value) params.set('unclaimed', '1')
  params.set('view', view.value === 'routing' ? 'active' : view.value)
  if (!silent) loading.value = true
  try {
    const data = await api<{ orders: OrderView[]; summary: Summary }>(`/api/orders?${params}`)
    orders.value = data.orders
    summary.value = data.summary
    if (selectedId.value) {
      const fresh = data.orders.find((order) => order.id === selectedId.value)
      if (fresh) pinned.value = fresh
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Gagal memuat antrian')
  } finally {
    if (!silent) loading.value = false
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

function openOrder(order: OrderView) {
  selectedId.value = order.id
  pinned.value = order
}

function onMainClick(event: MouseEvent) {
  if (!selectedId.value) return
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('[data-order-table]')) return
  selectedId.value = null
}

function onChanged(order: OrderView) {
  pinned.value = order
  const index = orders.value.findIndex((item) => item.id === order.id)
  if (index >= 0) orders.value[index] = order
  void load()
  void loadStatus()
}

function currentStep(order: OrderView) {
  if (order.channel === 'unassigned') return 'Pilih channel'
  return order.channelSteps.find((step) => step.state === 'current')?.label ?? (order.channelDone ? 'Selesai' : '—')
}

let poll = 0
onMounted(async () => {
  await Promise.all([load(), loadStatus()])
  poll = window.setInterval(() => {
    void load(true)
    void loadStatus()
  }, 20000)
})
onUnmounted(() => window.clearInterval(poll))
</script>

<template>
  <div class="flex h-dvh overflow-hidden">
    <Toaster position="top-right" />
    <ScrollArea type="always" class="h-full min-h-0 min-w-0 flex-1" @click="onMainClick">
    <header class="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div class="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
        <div class="mr-auto">
          <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Gudang</p>
          <h1 class="text-lg font-semibold leading-none">Proses order</h1>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <span class="text-muted-foreground">Petugas</span>
          <Input v-model="staff" placeholder="Nama" class="h-8 w-36" />
        </label>
        <p v-if="status?.lastSyncAt" class="text-xs text-muted-foreground">
          Sync {{ when(status.lastSyncAt) }}
        </p>
        <Button size="sm" variant="outline" type="button" :disabled="syncing" @click="refresh">
          <RefreshCwIcon :class="syncing ? 'animate-spin' : ''" />
          Segarkan
        </Button>
      </div>
    </header>

    <main class="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <div v-if="status?.usingSample" class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        Shopify belum terhubung. Ini data contoh. Isi <span class="font-mono">.env</span> lalu segarkan untuk menarik order sungguhan.
      </div>
      <div v-if="status?.lastError" class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {{ status.lastError }}
      </div>

      <p class="text-xs leading-relaxed text-muted-foreground">
        Antrian ini mengikuti filter order di Shopify:
        <span class="font-medium text-foreground">Fulfillment Unfulfilled</span>
        (termasuk Partial),
        <span class="font-medium text-foreground">Order bukan Canceled</span>,
        <span class="font-medium text-foreground">Payment Paid</span>.
      </p>

      <section class="grid grid-cols-2 gap-2 md:grid-cols-5">
        <button type="button" class="cursor-pointer rounded-xl border bg-card px-3 py-3 text-left shadow-xs" @click="preset('unclaimed')">
          <p class="text-xs text-muted-foreground">Belum diklaim</p>
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
          <p class="text-xs text-muted-foreground">Perlu channel</p>
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

      <Tabs :model-value="view" @update:model-value="view = String($event)">
        <TabsList>
          <TabsTrigger value="active">Antrian {{ summary?.queue ?? '' }}</TabsTrigger>
          <TabsTrigger value="awaiting_awb">Menunggu resi</TabsTrigger>
          <TabsTrigger value="ready">Siap pickup</TabsTrigger>
          <TabsTrigger value="routing">Peta kurir</TabsTrigger>
        </TabsList>
      </Tabs>

      <RoutingPanel v-if="view === 'routing'" />

      <section v-else class="rounded-xl border bg-card shadow-xs">
        <div class="flex flex-wrap items-center gap-2 border-b p-3">
          <div class="relative min-w-56 flex-1">
            <SearchIcon class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="q" placeholder="Cari nomor order, pelanggan, atau resi" class="pl-8" />
          </div>
          <Select v-model="channel">
            <SelectTrigger class="min-w-40 bg-background">
              <SelectValue placeholder="Semua channel" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="all">Semua channel</SelectItem>
              <SelectItem value="indocolite">Indocolite {{ summary?.byChannel.indocolite ?? 0 }}</SelectItem>
              <SelectItem value="biteship">Biteship {{ summary?.byChannel.biteship ?? 0 }}</SelectItem>
              <SelectItem value="dhl">DHL {{ summary?.byChannel.dhl ?? 0 }}</SelectItem>
              <SelectItem value="unassigned">Perlu dipilih</SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="warehouse">
            <SelectTrigger class="min-w-40 bg-background">
              <SelectValue placeholder="Semua langkah" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="all">Semua langkah</SelectItem>
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

        <Table data-order-table>
          <TableHeader>
            <TableRow>
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
              <TableCell>
                <p class="font-mono font-medium">{{ order.name }}</p>
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
              <TableCell colspan="7" class="py-10 text-center text-muted-foreground">
                Tidak ada order di tampilan ini.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>
    </main>
    </ScrollArea>

    <OrderSheet :order="selected" :staff="staff" @close="selectedId = null" @changed="onChanged" />
  </div>
</template>
