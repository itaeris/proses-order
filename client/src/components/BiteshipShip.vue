<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import type { OrderView } from '@/lib/types'

interface Rate {
  company: string
  shippingName: string
  serviceName: string
  serviceCode: string
  cost: number
  etd: string
}

interface Shipment {
  orderId: string | null
  awb: string | null
  shippingName: string | null
  serviceName: string | null
  cost: number | null
  status: string
  errorDetail?: string | null
}

interface Quote {
  balance: number | null
  weightKg: number
  originPostalCode: string
  destinationPostalCode: string
  rates: Rate[]
  shopifyRates: Rate[]
  shipment: Shipment | null
  notice: string | null
}

const props = defineProps<{ orderId: string; manual?: boolean }>()
const emit = defineEmits<{ changed: [order: OrderView] }>()

const quote = ref<Quote | null>(null)
const error = ref('')
const busy = ref(false)
const selectedRateKey = ref<string | undefined>(undefined)

const shownRates = computed(() => {
  if (!quote.value) return []
  return props.manual ? quote.value.rates : quote.value.shopifyRates
})
const substituteRates = computed(() => {
  if (!quote.value || props.manual || shownRates.value.length > 0) return []
  return quote.value.rates
})

watch(
  () => props.orderId,
  () => {
    quote.value = null
    error.value = ''
    selectedRateKey.value = undefined
    void load()
  },
  { immediate: true },
)

function path() {
  return `/api/orders/${encodeURIComponent(props.orderId)}/biteship`
}

async function load() {
  busy.value = true
  error.value = ''
  try {
    quote.value = await api<Quote>(path())
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Ongkir Biteship gagal dimuat'
    toast.error(error.value)
  } finally {
    busy.value = false
  }
}

function rateKey(rate: Rate) {
  return `${rate.company}|${rate.serviceCode}`
}

function chooseRate(value: unknown) {
  selectedRateKey.value = typeof value === 'string' && value ? value : undefined
}

function createSelected() {
  const rate = substituteRates.value.find((row) => rateKey(row) === selectedRateKey.value)
  if (rate) void create(rate)
}

async function create(rate: Rate) {
  busy.value = true
  try {
    const data = await api<{ shipment: Shipment; order: OrderView | null; balance: number | null }>(path(), {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        company: rate.company,
        serviceCode: rate.serviceCode,
        cost: rate.cost,
      }),
    })
    if (quote.value) quote.value = { ...quote.value, shipment: data.shipment, balance: data.balance }
    if (data.order) emit('changed', data.order)
    toast.success(data.shipment.awb ? `Resi ${data.shipment.awb}` : 'Permintaan resi dikirim')
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Resi gagal dibuat')
  } finally {
    busy.value = false
  }
}

async function refresh() {
  busy.value = true
  try {
    const data = await api<{ shipment: Shipment; order: OrderView | null; balance: number | null }>(path(), {
      method: 'POST',
      body: JSON.stringify({ action: 'refresh' }),
    })
    if (quote.value) quote.value = { ...quote.value, shipment: data.shipment, balance: data.balance }
    if (data.order) emit('changed', data.order)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Status resi gagal dicek')
  } finally {
    busy.value = false
  }
}

function rupiah(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
}
</script>

<template>
  <section class="space-y-3 rounded-lg border p-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold">Resi Biteship</h3>
      <p v-if="quote?.balance != null" class="text-xs text-muted-foreground">Saldo {{ rupiah(quote.balance) }}</p>
    </div>
    <p v-if="!quote && !error" class="text-sm text-muted-foreground">Memuat ongkir…</p>
    <p v-else-if="error && !quote" class="text-sm text-rose-800">{{ error }}</p>
    <template v-else-if="quote">
      <p v-if="quote.notice && !(manual && quote.notice.includes('lewat Manual'))" class="text-xs text-muted-foreground">{{ quote.notice }}</p>
      <p class="text-xs text-muted-foreground">Gudang {{ quote.originPostalCode }} → {{ quote.destinationPostalCode }}</p>
      <p v-if="quote.shipment?.awb" class="text-sm font-medium">
        <span class="font-mono">{{ quote.shipment.awb }}</span>
        <span v-if="quote.shipment.cost != null" class="font-normal text-muted-foreground"> · {{ rupiah(quote.shipment.cost) }}</span>
      </p>
      <p v-else-if="quote.shipment" class="text-xs text-muted-foreground">
        Status: {{ quote.shipment.status }}
        <span v-if="quote.shipment.shippingName" class="mt-1 block text-foreground">
          {{ quote.shipment.shippingName }} {{ quote.shipment.serviceName }}
          <template v-if="quote.shipment.cost != null"> · {{ rupiah(quote.shipment.cost) }}</template>
        </span>
        <span v-if="quote.shipment.errorDetail" class="mt-1 block text-rose-800">{{ quote.shipment.errorDetail }}</span>
      </p>

      <div v-if="!quote.shipment?.awb && substituteRates.length" class="space-y-2">
        <label class="block space-y-1 text-sm">
          <span class="text-muted-foreground">Pilih kurir</span>
          <Select :model-value="selectedRateKey" @update:model-value="chooseRate">
            <SelectTrigger class="w-full bg-background">
              <SelectValue placeholder="Pilih kurir dan ongkir" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem v-for="rate in substituteRates" :key="rateKey(rate)" :value="rateKey(rate)">
                {{ rate.shippingName }} {{ rate.serviceName }} · {{ rupiah(rate.cost) }}<template v-if="rate.etd"> · {{ rate.etd }}</template>
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
        <p class="text-xs text-muted-foreground">Berat paket {{ quote.weightKg }} kg. Saldo terpotong saat resi dibuat.</p>
        <Button type="button" class="w-full" :disabled="busy || !selectedRateKey" @click="createSelected">Buat resi</Button>
      </div>

      <div v-if="!quote.shipment?.awb && shownRates.length" class="space-y-2">
        <p class="text-xs text-muted-foreground">
          Berat paket {{ quote.weightKg }} kg.
          {{ manual ? 'Manual: kurir boleh diganti.' : 'Kurir mengikuti Shopify.' }}
          Saldo terpotong saat resi dibuat.
        </p>
        <Button
          v-for="rate in shownRates"
          :key="rateKey(rate)"
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
    </template>
  </section>
</template>
