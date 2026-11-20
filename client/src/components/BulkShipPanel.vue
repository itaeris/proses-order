<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeftIcon, CheckIcon } from '@lucide/vue'
import PickupSchedule from '@/components/PickupSchedule.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CHANNEL_LABEL, WAREHOUSE_LABEL, type ChannelId, type OrderView } from '@/lib/types'

type Courier = Exclude<ChannelId, 'unassigned'>

interface ShipRow {
  id: string
  name: string
  status: 'created' | 'processing' | 'failed'
  awb: string | null
  courier: string | null
  service: string | null
  cost: number | null
  pickup: string | null
  detail: string
}

const props = defineProps<{
  channel: Courier
  orders: OrderView[]
  results: ShipRow[]
  job: '' | 'ship' | 'check' | 'pickup' | 'validate'
}>()

const emit = defineEmits<{
  back: []
  ship: []
  check: []
  pickup: [input: { date: string; time: string; vehicle: string }]
  validate: [awb: string]
}>()

const scan = ref('')

const pickupDate = ref(tomorrow())
const pickupTime = ref('10:00')
const pickupVehicle = ref('Motor')

const FLOWS: Record<Courier, string[]> = {
  indocolite: [
    'Buat resi memakai tarif termurah. Kalau ekspedisi itu tidak bisa, dipakai ekspedisi berikutnya. Saldo terpotong saat permintaan masuk.',
    'Ajukan pickup untuk semua order. Nomor resi keluar setelah pickup diajukan.',
    'Cek status untuk semua order sampai nomor resi tampil.',
    'Cocokkan nomor resi di halaman ini, lalu tandai sudah dicek. Siap pickup menyala setelah itu.',
  ],
  biteship: [
    'Buat resi memakai tarif termurah. Saldo terpotong dan nomor resi langsung masuk.',
    'Ajukan pickup untuk semua order.',
    'Cek status kalau nomor resi belum tampil.',
    'Cocokkan nomor resi di halaman ini, lalu tandai sudah dicek. Siap pickup menyala setelah itu.',
  ],
  dhl: [
    'Buat resi memakai produk termurah. Kiriman dibuat di akun DHL. Label PDF ada di halaman order.',
    'Ajukan pickup untuk semua order.',
    'Cek status kalau nomor resi belum tampil.',
    'Cocokkan nomor resi di halaman ini, lalu tandai sudah dicek. Siap pickup menyala setelah itu.',
  ],
}

const resultOf = computed(() => {
  const map = new Map<string, ShipRow>()
  for (const row of props.results) map.set(row.id, row)
  return map
})

const summary = computed(() => {
  if (props.results.length === 0) return ''
  const created = props.results.filter((row) => row.status === 'created').length
  const pending = props.results.filter((row) => row.status === 'processing').length
  const failed = props.results.filter((row) => row.status === 'failed').length
  const parts = []
  if (created) parts.push(`${created} resi jadi`)
  if (pending) parts.push(`${pending} permintaan masuk, nomor belum keluar`)
  if (failed) parts.push(`${failed} gagal`)
  return parts.join(' · ')
})

const failed = computed(() => props.results.filter((row) => row.status === 'failed'))
const openRows = computed(() => props.results.filter((row) => row.status !== 'failed'))
const showShip = computed(() => props.results.length === 0 || failed.value.length > 0)
const showPickup = computed(() => openRows.value.some((row) => !row.pickup))
const showCheck = computed(() => openRows.value.some((row) => row.pickup && !row.awb))

function resiOf(order: OrderView) {
  return resultOf.value.get(order.id)?.awb || order.awbNumber || ''
}

const awaitingCheck = computed(() => props.orders.filter((order) => resiOf(order) && !order.awbValidatedAt && order.warehouseStep === 'validasi_awb'))
const showValidate = computed(() => awaitingCheck.value.length > 0)
const allChecked = computed(() => props.orders.length > 0 && props.orders.some((order) => order.awbValidatedAt) && props.orders.every((order) => !resiOf(order) || order.awbValidatedAt))

const activeStep = computed(() => {
  if (props.results.length === 0 || openRows.value.length === 0) return 0
  if (allChecked.value) return 4
  if (openRows.value.every((row) => row.awb && row.pickup)) return 3
  if (openRows.value.every((row) => row.pickup)) return 2
  return 1
})

function tone(status: ShipRow['status']) {
  if (status === 'failed') return 'text-rose-800'
  if (status === 'processing') return 'text-amber-950'
  return 'text-emerald-800'
}

function rupiah(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
}

function offer(row: ShipRow) {
  const name = [row.courier, row.service].filter(Boolean).join(' ')
  const price = row.cost == null ? '' : rupiah(row.cost)
  return [name, price].filter(Boolean).join(' · ')
}

function submitScan() {
  const awb = scan.value.trim()
  if (!awb || props.job !== '') return
  scan.value = ''
  emit('validate', awb)
}

function tomorrow() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-4">
    <div class="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm" type="button" class="cursor-pointer" @click="emit('back')">
        <ArrowLeftIcon class="size-4" />
        Antrian
      </Button>
      <div class="min-w-0">
        <h2 class="text-lg font-semibold">Pengiriman masal {{ CHANNEL_LABEL[channel] }}</h2>
        <p class="text-xs text-muted-foreground">Print label, packing, dan kurir tetap dikerjakan di halaman order. Menu ini hanya bagian kirimnya.</p>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ol class="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
        <li v-for="(step, index) in FLOWS[channel]" :key="step" class="flex gap-2 text-sm">
          <span
            class="grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium"
            :class="index < activeStep ? 'bg-emerald-700 text-white' : index === activeStep && results.length ? 'bg-primary text-primary-foreground' : 'bg-muted'"
          >
            {{ index + 1 }}
          </span>
          <span :class="index > activeStep || results.length === 0 ? '' : 'font-medium'">{{ step }}</span>
        </li>
      </ol>

      <section class="flex min-h-0 flex-col rounded-xl border bg-card shadow-xs">
        <div class="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <div class="mr-auto min-w-0">
            <p class="text-sm font-medium">{{ orders.length }} order</p>
            <p v-if="summary" class="text-xs text-muted-foreground">{{ summary }}</p>
            <p v-if="allChecked" class="text-xs text-muted-foreground">Resi sudah dicek. Order siap pickup.</p>
          </div>
          <Button v-if="showShip" type="button" class="cursor-pointer" :disabled="job !== '' || orders.length === 0" @click="emit('ship')">
            {{ job === 'ship' ? 'Membuat resi…' : 'Buat resi' }}
          </Button>
          <Button v-if="showCheck" type="button" class="cursor-pointer" :disabled="job !== ''" @click="emit('check')">
            {{ job === 'check' ? 'Mengecek…' : 'Cek status' }}
          </Button>
        </div>
        <form v-if="showValidate" class="flex flex-wrap items-end gap-2 border-b px-3 py-3" @submit.prevent="submitScan">
          <div class="min-w-56 flex-1 space-y-1">
            <label class="text-sm font-medium" for="bulk-awb">Scan resi</label>
            <Input id="bulk-awb" v-model="scan" placeholder="Scan resi" class="font-mono" autocomplete="off" autofocus />
          </div>
          <Button type="submit" class="cursor-pointer" :disabled="job !== '' || scan.trim() === ''">
            {{ job === 'validate' ? 'Memvalidasi…' : 'Validate Resi' }}
          </Button>
        </form>
        <form
          v-if="showPickup"
          class="flex flex-wrap items-end gap-3 border-b px-3 py-3"
          @submit.prevent="emit('pickup', { date: pickupDate, time: pickupTime, vehicle: pickupVehicle })"
        >
          <div class="min-w-0 flex-1 space-y-2">
            <p class="text-sm font-medium">Ajukan pickup untuk semua order</p>
            <PickupSchedule v-model:date="pickupDate" v-model:time="pickupTime" v-model:vehicle="pickupVehicle" />
          </div>
          <Button type="submit" class="cursor-pointer" :disabled="job !== ''">
            {{ job === 'pickup' ? 'Mengajukan…' : 'Ajukan pickup' }}
          </Button>
        </form>
        <p v-if="orders.length === 0" class="px-3 py-8 text-sm text-muted-foreground">Belum ada order dipilih. Kembali ke antrian, filter ekspedisinya, lalu centang order.</p>
        <ul v-else class="min-h-0 flex-1 space-y-2 overflow-auto p-3">
          <li v-for="order in orders" :key="order.id" class="rounded-lg border px-3 py-2">
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="order.awbValidatedAt" class="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-700 text-white" title="Resi cocok">
                <CheckIcon class="size-3.5" />
              </span>
              <p class="font-mono text-sm font-semibold">{{ order.name }}</p>
              <Badge variant="outline">{{ WAREHOUSE_LABEL[order.warehouseStep] }}</Badge>
              <p class="text-xs text-muted-foreground">{{ order.assignee || 'Belum ada petugas' }}</p>
            </div>
            <p class="mt-1 truncate text-sm">{{ order.customerName }}</p>
            <p v-if="order.deliveryMethod" class="truncate text-xs text-muted-foreground">{{ order.deliveryMethod }}</p>
            <p v-if="resiOf(order)" class="mt-2 font-mono text-sm font-semibold">Resi {{ resiOf(order) }}</p>
            <p v-if="order.awbValidatedAt" class="text-xs text-emerald-800">Sudah dicek<span v-if="order.awbValidatedBy"> oleh {{ order.awbValidatedBy }}</span>. Siap pickup.</p>
            <p v-if="resultOf.get(order.id)?.pickup" class="mt-1 text-xs font-medium">{{ resultOf.get(order.id)?.pickup }}</p>
            <p v-if="resultOf.get(order.id) && offer(resultOf.get(order.id)!)" class="mt-1 text-xs font-medium">{{ offer(resultOf.get(order.id)!) }}</p>
            <p v-if="resultOf.get(order.id)" class="text-xs" :class="tone(resultOf.get(order.id)!.status)">{{ resultOf.get(order.id)?.detail }}</p>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>
