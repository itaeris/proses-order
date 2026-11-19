<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { OrderView } from '@/lib/types'

interface Place {
  id: number
  label: string
}

interface Rate {
  shippingName: string
  serviceName: string
  cost: number
  etd: string
}

interface Shipment {
  requestId: string | null
  shipmentId: string | null
  awb: string | null
  shippingName: string | null
  serviceName: string | null
  cost: number | null
  status: string
  errorDetail?: string | null
}

interface Quote {
  balance: number
  weightKg: number
  origin: Place | null
  destination: Place | null
  rates: Rate[]
  shopifyRates: Rate[]
  shipment: Shipment | null
  notice: string | null
}

const props = defineProps<{ orderId: string; manual?: boolean }>()
const emit = defineEmits<{ changed: [order: OrderView] }>()

const quote = ref<Quote | null>(null)
const busy = ref(false)
const pickupDate = ref(tomorrow())
const pickupTime = ref('10:00')
const pickupVehicle = ref('Motor')
const shownRates = computed(() => {
  if (!quote.value) return []
  return props.manual ? quote.value.rates : quote.value.shopifyRates
})
const offer = computed(() => cheapest(shownRates.value.length ? shownRates.value : (quote.value?.rates ?? [])))
const shopifyCourier = computed(() => !props.manual && shownRates.value.length > 0)

watch(
  () => props.orderId,
  () => {
    quote.value = null
    void load()
  },
  { immediate: true },
)

function path() {
  return `/api/orders/${encodeURIComponent(props.orderId)}/indocolite`
}

async function load() {
  busy.value = true
  try {
    quote.value = await api<Quote>(path())
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Ongkir Indocolite gagal dimuat')
  } finally {
    busy.value = false
  }
}

function cheapest(rows: Rate[]) {
  return rows.reduce<Rate | null>((best, row) => (!best || row.cost < best.cost ? row : best), null)
}

async function create(rate: Rate) {
  if (!quote.value?.destination) return
  busy.value = true
  try {
    const data = await api<{ shipment: Shipment; order: OrderView | null }>(path(), {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        destinationId: quote.value.destination.id,
        shippingName: rate.shippingName,
        serviceName: rate.serviceName,
        cost: rate.cost,
      }),
    })
    if (quote.value) quote.value = { ...quote.value, shipment: data.shipment }
    if (data.order) emit('changed', data.order)
    toast.success(data.shipment.awb ? `Resi ${data.shipment.awb}` : 'Permintaan resi dikirim')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Resi gagal dibuat')
  } finally {
    busy.value = false
  }
}

async function refresh() {
  busy.value = true
  try {
    const data = await api<{ shipment: Shipment; order: OrderView | null }>(path(), {
      method: 'POST',
      body: JSON.stringify({ action: 'refresh' }),
    })
    if (quote.value) quote.value = { ...quote.value, shipment: data.shipment }
    if (data.order) emit('changed', data.order)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Status resi gagal dicek')
  } finally {
    busy.value = false
  }
}

async function pickup() {
  busy.value = true
  try {
    const data = await api<{ shipment: Shipment; order: OrderView | null }>(path(), {
      method: 'POST',
      body: JSON.stringify({
        action: 'pickup',
        date: pickupDate.value,
        time: pickupTime.value,
        vehicle: pickupVehicle.value,
      }),
    })
    if (quote.value) quote.value = { ...quote.value, shipment: data.shipment }
    if (data.order) emit('changed', data.order)
    toast.success('Pickup diajukan')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Pickup gagal diajukan')
  } finally {
    busy.value = false
  }
}

function rupiah(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
}

function tomorrow() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
</script>

<template>
  <section class="space-y-3 rounded-lg border p-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold">Resi Indocolite</h3>
      <p v-if="quote" class="text-xs text-muted-foreground">Saldo {{ rupiah(quote.balance) }}</p>
    </div>
    <p v-if="!quote" class="text-sm text-muted-foreground">Memuat ongkir…</p>
    <template v-else>
      <p v-if="quote.notice && !(manual && quote.notice.includes('lewat Manual'))" class="text-xs text-muted-foreground">{{ quote.notice }}</p>
      <p v-if="quote.shipment?.awb" class="text-sm font-medium">
        <span class="font-mono">{{ quote.shipment.awb }}</span>
        <span v-if="quote.shipment.cost != null" class="font-normal text-muted-foreground"> · {{ rupiah(quote.shipment.cost) }}</span>
      </p>
      <p v-else-if="quote.shipment" class="text-xs text-muted-foreground">
        Status permintaan: {{ quote.shipment.status }}
        <span v-if="quote.shipment.shippingName" class="mt-1 block text-foreground">
          {{ quote.shipment.shippingName }} {{ quote.shipment.serviceName }}
          <template v-if="quote.shipment.cost != null"> · {{ rupiah(quote.shipment.cost) }}</template>
        </span>
        <span v-if="quote.shipment.errorDetail" class="mt-1 block text-rose-800">{{ quote.shipment.errorDetail }}</span>
      </p>

      <p v-if="quote.origin" class="text-xs text-muted-foreground">Gudang: {{ quote.origin.label }}</p>
      <p v-if="quote.destination" class="text-xs text-muted-foreground">Tujuan: {{ quote.destination.label }}</p>

      <div v-if="!quote.shipment?.awb && offer" class="space-y-2">
        <p class="text-sm">
          {{ offer.shippingName }} {{ offer.serviceName }}
          <span class="text-muted-foreground"> · {{ rupiah(offer.cost) }}</span>
          <span v-if="offer.etd && offer.etd !== '-'" class="text-muted-foreground"> · {{ offer.etd }}</span>
        </p>
        <p class="text-xs text-muted-foreground">Berat paket {{ quote.weightKg }} kg. {{ shopifyCourier ? 'Dipakai tarif termurah dari kurir Shopify.' : 'Dipakai tarif termurah.' }} Saldo terpotong saat resi dibuat.</p>
        <Button type="button" class="w-full" :disabled="busy" @click="create(offer)">Buat resi</Button>
      </div>

      <Button v-if="quote.shipment && !quote.shipment.awb" variant="outline" type="button" :disabled="busy" @click="refresh">
        Cek status resi
      </Button>

      <form v-if="quote.shipment?.shipmentId" class="space-y-2" @submit.prevent="pickup">
        <p class="text-sm font-medium">Ajukan pickup</p>
        <div class="grid grid-cols-3 gap-2">
          <input v-model="pickupDate" type="date" class="h-8 rounded-lg border bg-background px-2 text-xs" />
          <input v-model="pickupTime" type="time" class="h-8 rounded-lg border bg-background px-2 text-xs" />
          <select v-model="pickupVehicle" class="h-8 rounded-lg border bg-background px-2 text-xs">
            <option>Motor</option>
            <option>Mobil</option>
            <option>Truk</option>
          </select>
        </div>
        <Button type="submit" :disabled="busy">Ajukan pickup</Button>
      </form>
    </template>
  </section>
</template>
