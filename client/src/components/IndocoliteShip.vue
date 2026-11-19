<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  originChoices: Place[]
  destination: Place | null
  destinationChoices: Place[]
  rates: Rate[]
  shopifyRates: Rate[]
  shipment: Shipment | null
  notice: string | null
}

const props = defineProps<{ orderId: string; manual?: boolean }>()
const emit = defineEmits<{ changed: [order: OrderView] }>()

const quote = ref<Quote | null>(null)
const busy = ref(false)
const destinationId = ref<string | undefined>(undefined)
const pickupDate = ref(tomorrow())
const pickupTime = ref('10:00')
const pickupVehicle = ref('Motor')
const pickingOrigin = ref(false)
const shownRates = computed(() => {
  if (!quote.value) return []
  return props.manual ? quote.value.rates : quote.value.shopifyRates
})

watch(
  () => props.orderId,
  () => {
    quote.value = null
    destinationId.value = undefined
    void load()
  },
  { immediate: true },
)

function path(suffix = '') {
  return `/api/orders/${encodeURIComponent(props.orderId)}/indocolite${suffix}`
}

async function load(nextDestination?: string) {
  busy.value = true
  try {
    const query = nextDestination ? `?destinationId=${encodeURIComponent(nextDestination)}` : ''
    quote.value = await api<Quote>(path(query))
    destinationId.value = quote.value.destination ? String(quote.value.destination.id) : undefined
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Ongkir Indocolite gagal dimuat')
  } finally {
    busy.value = false
  }
}

async function chooseOrigin(value: unknown) {
  if (!pickingOrigin.value) return
  pickingOrigin.value = false
  if (typeof value !== 'string' || !value) return
  if (quote.value?.origin && String(quote.value.origin.id) === value) return
  busy.value = true
  try {
    quote.value = await api<Quote>(path(), {
      method: 'POST',
      body: JSON.stringify({ action: 'origin', originId: Number(value) }),
    })
    destinationId.value = quote.value.destination ? String(quote.value.destination.id) : undefined
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Kelurahan gudang gagal disimpan')
  } finally {
    busy.value = false
  }
}

async function chooseDestination(value: unknown) {
  if (typeof value !== 'string' || !value || value === destinationId.value) return
  await load(value)
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
      <p v-if="quote.shipment?.awb" class="font-mono text-sm font-medium">{{ quote.shipment.awb }}</p>
      <p v-else-if="quote.shipment" class="text-xs text-muted-foreground">
        Status permintaan: {{ quote.shipment.status }}
        <span v-if="quote.shipment.errorDetail" class="mt-1 block text-rose-800">{{ quote.shipment.errorDetail }}</span>
      </p>

      <label v-if="!quote.origin && quote.originChoices.length > 1" class="block space-y-1 text-sm">
        <span class="text-muted-foreground">Kelurahan gudang</span>
        <Select @update:model-value="chooseOrigin">
          <SelectTrigger class="w-full bg-background" @pointerdown="pickingOrigin = true">
            <SelectValue placeholder="Pilih kelurahan" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem v-for="place in quote.originChoices" :key="place.id" :value="String(place.id)">{{ place.label }}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <p v-else-if="quote.origin" class="text-xs text-muted-foreground">Gudang: {{ quote.origin.label }}</p>

      <label v-if="!quote.destination && quote.destinationChoices.length > 1" class="block space-y-1 text-sm">
        <span class="text-muted-foreground">Kelurahan penerima</span>
        <Select :model-value="destinationId" @update:model-value="chooseDestination">
          <SelectTrigger class="w-full bg-background">
            <SelectValue placeholder="Pilih kelurahan" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem v-for="place in quote.destinationChoices" :key="place.id" :value="String(place.id)">{{ place.label }}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <p v-else-if="quote.destination" class="text-xs text-muted-foreground">Tujuan: {{ quote.destination.label }}</p>

      <div v-if="!quote.shipment?.awb && shownRates.length" class="space-y-2">
        <p class="text-xs text-muted-foreground">
          Berat paket {{ quote.weightKg }} kg.
          {{ manual ? 'Manual: kurir boleh diganti.' : 'Kurir mengikuti Shopify.' }}
          Saldo terpotong saat resi dibuat.
        </p>
        <Button
          v-for="rate in shownRates"
          :key="rate.shippingName + rate.serviceName"
          variant="outline"
          class="h-auto w-full justify-between whitespace-normal"
          type="button"
          :disabled="busy"
          @click="create(rate)"
        >
          <span>{{ rate.shippingName }} {{ rate.serviceName }}</span>
          <span class="font-medium">{{ rupiah(rate.cost) }}<span v-if="rate.etd" class="font-normal text-muted-foreground"> · {{ rate.etd }}</span></span>
        </Button>
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
