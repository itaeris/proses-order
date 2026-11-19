<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { OrderView } from '@/lib/types'

interface Rate {
  productCode: string
  localProductCode: string
  shippingName: string
  serviceName: string
  cost: number
  currency: string
  etd: string
}

interface Shipment {
  awb: string | null
  shippingName: string | null
  serviceName: string | null
  cost: number | null
  currency: string | null
  status: string
  hasLabel: boolean
  errorDetail?: string | null
}

interface Quote {
  weightKg: number
  originPostalCode: string
  destinationPostalCode: string
  destinationCountry: string
  rates: Rate[]
  shipment: Shipment | null
  notice: string | null
}

const props = defineProps<{ orderId: string }>()
const emit = defineEmits<{ changed: [order: OrderView] }>()

const quote = ref<Quote | null>(null)
const error = ref('')
const busy = ref(false)

const offer = computed(() => {
  const rows = quote.value?.rates ?? []
  return rows.reduce<Rate | null>((best, row) => (!best || row.cost < best.cost ? row : best), null)
})

watch(
  () => props.orderId,
  () => {
    quote.value = null
    error.value = ''
    void load()
  },
  { immediate: true },
)

function path(suffix = '') {
  return `/api/orders/${encodeURIComponent(props.orderId)}/dhl${suffix}`
}

async function load() {
  busy.value = true
  error.value = ''
  try {
    quote.value = await api<Quote>(path())
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Ongkir DHL gagal dimuat'
    toast.error(error.value)
  } finally {
    busy.value = false
  }
}

async function create(rate: Rate) {
  busy.value = true
  try {
    const data = await api<{ shipment: Shipment; order: OrderView | null }>(path(), {
      method: 'POST',
      body: JSON.stringify({ action: 'create', productCode: rate.productCode, cost: rate.cost }),
    })
    if (quote.value) quote.value = { ...quote.value, shipment: data.shipment }
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
    const data = await api<{ shipment: Shipment; order: OrderView | null }>(path(), {
      method: 'POST',
      body: JSON.stringify({ action: 'refresh' }),
    })
    if (quote.value) quote.value = { ...quote.value, shipment: data.shipment }
    if (data.order) emit('changed', data.order)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Status resi gagal dicek')
  } finally {
    busy.value = false
  }
}

async function downloadLabel() {
  busy.value = true
  try {
    const data = await api<{ content: string; format: string }>(path('/label'))
    const bytes = Uint8Array.from(atob(data.content), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `dhl-${quote.value?.shipment?.awb || 'label'}.pdf`
    link.click()
    URL.revokeObjectURL(url)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Label gagal diunduh')
  } finally {
    busy.value = false
  }
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'IDR' ? 0 : 2,
    }).format(value)
  } catch {
    return `${currency} ${value}`
  }
}
</script>

<template>
  <section class="space-y-3 rounded-lg border p-3">
    <h3 class="text-sm font-semibold">Resi DHL</h3>
    <p v-if="!quote && !error" class="text-sm text-muted-foreground">Memuat ongkir…</p>
    <p v-else-if="error && !quote" class="text-sm text-rose-800">{{ error }}</p>
    <template v-else-if="quote">
      <p v-if="quote.notice" class="text-xs text-muted-foreground">{{ quote.notice }}</p>
      <p class="text-xs text-muted-foreground">
        Gudang {{ quote.originPostalCode }} → {{ quote.destinationPostalCode }}, {{ quote.destinationCountry }}
      </p>
      <p v-if="quote.shipment?.awb" class="text-sm font-medium">
        <span class="font-mono">{{ quote.shipment.awb }}</span>
        <span v-if="quote.shipment.cost != null && quote.shipment.currency" class="font-normal text-muted-foreground">
          · {{ money(quote.shipment.cost, quote.shipment.currency) }}
        </span>
      </p>
      <p v-else-if="quote.shipment" class="text-xs text-muted-foreground">
        Status: {{ quote.shipment.status }}
        <span v-if="quote.shipment.serviceName" class="mt-1 block text-foreground">{{ quote.shipment.serviceName }}</span>
        <span v-if="quote.shipment.errorDetail" class="mt-1 block text-rose-800">{{ quote.shipment.errorDetail }}</span>
      </p>

      <div v-if="!quote.shipment?.awb && offer" class="space-y-2">
        <p class="text-sm">
          {{ offer.serviceName }}
          <span class="text-muted-foreground"> · {{ money(offer.cost, offer.currency) }}</span>
          <span v-if="offer.etd" class="text-muted-foreground"> · {{ offer.etd }}</span>
        </p>
        <p class="text-xs text-muted-foreground">
          Berat paket {{ quote.weightKg }} kg. Dipakai tarif termurah. Resi dibuat di akun DHL saat tombol ditekan.
        </p>
        <Button type="button" class="w-full" :disabled="busy" @click="create(offer)">Buat resi</Button>
      </div>

      <div v-if="quote.shipment?.awb" class="flex flex-wrap gap-2">
        <Button v-if="quote.shipment.hasLabel" variant="outline" type="button" :disabled="busy" @click="downloadLabel">
          Unduh label
        </Button>
        <Button variant="outline" type="button" :disabled="busy" @click="refresh">Cek status resi</Button>
      </div>
    </template>
  </section>
</template>
