<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowLeftIcon, CheckIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import BiteshipShip from '@/components/BiteshipShip.vue'
import IndocoliteShip from '@/components/IndocoliteShip.vue'
import { api } from '@/lib/api'
import { money, when } from '@/lib/format'
import { CHANNEL_LABEL, type ChannelId, type OrderView, type StepDef } from '@/lib/types'

const props = defineProps<{
  order: OrderView | null
}>()

const emit = defineEmits<{
  close: []
  changed: [order: OrderView]
}>()

const awbDraft = ref('')

function thumb(url: string) {
  try {
    const next = new URL(url)
    next.searchParams.set('width', '96')
    return next.toString()
  } catch {
    return url
  }
}
const problemDraft = ref('')
const busy = ref(false)

watch(
  () => props.order?.id,
  () => {
    awbDraft.value = props.order?.awbNumber || props.order?.trackingNumber || ''
    problemDraft.value = props.order?.problemNote || ''
  },
  { immediate: true },
)

const currentChannel = computed(() => props.order?.channelSteps.find((step) => step.state === 'current'))

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.order) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

async function act(body: Record<string, unknown>, success?: string) {
  if (!props.order) return
  busy.value = true
  try {
    const data = await api<{ order: OrderView }>(`/api/orders/${encodeURIComponent(props.order.id)}/actions`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    emit('changed', data.order)
    if (success) toast.success(success)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Aksi gagal')
  } finally {
    busy.value = false
  }
}

function claim() {
  void act({ action: 'claim' }, 'Order diklaim')
}

function validateAwb() {
  void act({ action: 'validate_awb', awbNumber: awbDraft.value }, 'Resi divalidasi')
}

const channelTone: Record<ChannelId, string> = {
  indocolite: 'bg-sky-100 text-sky-950',
  biteship: 'bg-violet-100 text-violet-950',
  dhl: 'bg-amber-100 text-amber-950',
  unassigned: 'bg-rose-100 text-rose-950',
}

function stepClass(step: StepDef) {
  if (step.state === 'done') return 'border-emerald-700 bg-emerald-700 text-white'
  if (step.state === 'current') return 'border-foreground bg-foreground text-background'
  return 'border-border text-muted-foreground'
}
</script>

<template>
  <div v-if="order" class="flex min-h-0 flex-1 flex-col bg-background">
      <header class="shrink-0 border-b px-4 py-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="font-mono text-lg font-semibold">{{ order.name }}</h2>
              <Badge variant="outline" :class="channelTone[order.channel]">{{ CHANNEL_LABEL[order.channel] }}</Badge>
              <Badge v-if="order.overdue" variant="destructive">Terlambat</Badge>
            </div>
            <p class="mt-1 text-sm text-muted-foreground">
              {{ order.customerName }} · {{ money(order.totalAmount, order.currency) }} · {{ order.itemCount }} item
            </p>
          </div>
          <Button variant="outline" size="sm" type="button" @click="emit('close')">
            <ArrowLeftIcon />
            Antrian
          </Button>
        </div>
      </header>

      <ScrollArea type="always" class="min-h-0 flex-1">
      <div class="grid gap-6 px-4 py-4 lg:grid-cols-2">
        <div class="space-y-6">
          <section class="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p class="text-muted-foreground">Metode kirim</p>
              <p class="font-medium">{{ order.deliveryMethod || '—' }}</p>
            </div>
            <div>
              <p class="text-muted-foreground">Fulfill by</p>
              <p class="font-medium">{{ when(order.fulfillBy) }}</p>
            </div>
            <div class="sm:col-span-2">
              <p class="text-muted-foreground">Alamat</p>
              <p>{{ order.shippingAddress || '—' }}</p>
            </div>
          </section>

          <section>
            <h3 class="text-sm font-semibold">Item</h3>
            <ul class="mt-2 divide-y rounded-lg border">
              <li v-for="(item, index) in order.items" :key="`${item.sku ?? item.name}-${index}`" class="flex items-center gap-3 px-3 py-2 text-sm">
                <img
                  v-if="item.imageUrl"
                  :src="thumb(item.imageUrl)"
                  :alt="item.name"
                  class="size-12 shrink-0 rounded-md border object-cover"
                />
                <div v-else class="size-12 shrink-0 rounded-md border bg-muted" />
                <span class="min-w-0 flex-1">{{ item.name }}</span>
                <span class="text-muted-foreground">× {{ item.quantity }}</span>
              </li>
            </ul>
          </section>

          <section class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
            <p class="text-sm">
              <span class="text-muted-foreground">Petugas</span>
              <span class="ml-2 font-medium">{{ order.assignee || 'Belum diklaim' }}</span>
            </p>
            <Button v-if="order.assignee" variant="outline" size="sm" type="button" :disabled="busy" @click="act({ action: 'release' })">
              Lepas
            </Button>
            <Button v-else size="sm" type="button" :disabled="busy" @click="claim">Klaim</Button>
          </section>

        </div>
        <div class="space-y-6">
          <section>
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold">Channel kurir</h3>
              <Button
                v-if="order.channel !== 'unassigned' && (order.channelDone || order.channelSteps.some((step) => step.state === 'done'))"
                variant="ghost"
                size="sm"
                type="button"
                :disabled="busy"
                @click="act({ action: 'retreat_channel' })"
              >
                Langkah sebelumnya
              </Button>
            </div>
            <p v-if="order.deliveryMethod" class="mt-2 text-sm">
              {{ order.deliveryMethod }}
              <span class="text-muted-foreground">· dari Shopify</span>
            </p>
            <div v-if="!order.deliveryMethod || order.channel === 'unassigned' || order.indocoliteMode === 'manual'" class="mt-2 flex flex-wrap gap-2">
              <Button
                v-for="channel in (['indocolite', 'biteship', 'dhl'] as const)"
                :key="channel"
                size="sm"
                type="button"
                :variant="order.channel === channel ? 'default' : 'outline'"
                :disabled="busy"
                @click="act({ action: 'set_channel', channel })"
              >
                {{ CHANNEL_LABEL[channel] }}
              </Button>
            </div>
            <div v-if="order.deliveryMethod || order.channel === 'indocolite'" class="mt-2 flex gap-2">
              <Button size="sm" type="button" :variant="order.indocoliteMode === 'manual' ? 'default' : 'outline'" :disabled="busy" @click="act({ action: 'set_mode', mode: 'manual' })">
                Manual
              </Button>
              <Button size="sm" type="button" :variant="order.indocoliteMode === 'otomatis' ? 'default' : 'outline'" :disabled="busy" @click="act({ action: 'set_mode', mode: 'otomatis' })">
                Otomatis
              </Button>
            </div>
            <ol v-if="order.channelSteps.length" class="mt-3 space-y-2">
              <li v-for="step in order.channelSteps" :key="step.id" class="flex items-center gap-2 text-sm">
                <span class="flex size-5 items-center justify-center rounded-full border" :class="stepClass(step)">
                  <CheckIcon v-if="step.state === 'done'" class="size-3" />
                </span>
                <span :class="step.state === 'upcoming' ? 'text-muted-foreground' : 'font-medium'">{{ step.label }}</span>
              </li>
            </ol>
            <Button
              v-if="!order.channelDone && order.channel !== 'unassigned' && !order.needsMode"
              class="mt-3"
              type="button"
              :disabled="busy"
              @click="act({ action: 'advance_channel' }, 'Langkah kurir dicatat')"
            >
              Selesai: {{ currentChannel?.label }}
            </Button>
            <p v-else-if="order.needsMode" class="mt-3 text-sm text-muted-foreground">Pilih pengiriman manual atau otomatis.</p>
            <IndocoliteShip
              v-if="order.channel === 'indocolite'"
              class="mt-3"
              :order-id="order.id"
              :manual="order.indocoliteMode === 'manual'"
              @changed="emit('changed', $event)"
            />
            <BiteshipShip
              v-if="order.channel === 'biteship'"
              class="mt-3"
              :order-id="order.id"
              :manual="order.indocoliteMode === 'manual'"
              @changed="emit('changed', $event)"
            />
          </section>

          <section>
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold">Proses di Shopify</h3>
              <Button
                v-if="order.warehouseStep !== 'print_label'"
                variant="ghost"
                size="sm"
                type="button"
                :disabled="busy"
                @click="act({ action: 'retreat_warehouse' })"
              >
                Langkah sebelumnya
              </Button>
            </div>
            <ol class="mt-3 space-y-2">
              <li v-for="step in order.warehouseSteps" :key="step.id" class="flex items-center gap-2 text-sm">
                <span class="flex size-5 items-center justify-center rounded-full border" :class="stepClass(step)">
                  <CheckIcon v-if="step.state === 'done'" class="size-3" />
                </span>
                <span :class="step.state === 'upcoming' ? 'text-muted-foreground' : 'font-medium'">{{ step.label }}</span>
              </li>
            </ol>

            <div class="mt-3 flex gap-2">
              <Button
                v-if="order.warehouseStep === 'print_label'"
                type="button"
                :disabled="busy"
                @click="act({ action: 'advance_warehouse' }, 'Label dicatat')"
              >
                Label sudah dicetak
              </Button>
              <Button
                v-else-if="order.warehouseStep === 'packing'"
                type="button"
                :disabled="busy"
                @click="act({ action: 'advance_warehouse' }, 'Packing selesai')"
              >
                Packing selesai
              </Button>
            </div>

            <form
              v-if="order.warehouseStep === 'validasi_awb' || order.warehouseStep === 'siap_pickup'"
              class="mt-4 space-y-2"
              @submit.prevent="validateAwb"
            >
              <label class="text-sm font-medium" for="awb">Nomor resi</label>
              <Input id="awb" v-model="awbDraft" placeholder="Scan atau ketik resi" class="font-mono" :disabled="order.warehouseStep === 'siap_pickup'" />
              <p v-if="order.trackingNumber && !order.awbValidatedAt" class="text-xs text-muted-foreground">
                Shopify sudah punya resi {{ order.trackingNumber }}. Tetap harus divalidasi sebelum pickup.
              </p>
              <p v-if="order.awbValidatedAt" class="text-xs text-emerald-800">
                Divalidasi {{ when(order.awbValidatedAt) }}<span v-if="order.awbValidatedBy"> oleh {{ order.awbValidatedBy }}</span>
              </p>
              <p v-else-if="order.channelDone" class="text-xs text-muted-foreground">
                Kurir belum boleh pickup sebelum resi ini divalidasi.
              </p>
              <p v-else class="text-xs text-muted-foreground">
                Resi bisa divalidasi sekarang. Siap pickup menyala setelah langkah kurir juga selesai.
              </p>
              <div class="flex gap-2">
                <Button v-if="order.warehouseStep !== 'siap_pickup'" type="submit" :disabled="busy">Validasi resi</Button>
                <Button
                  v-if="order.awbValidatedAt"
                  variant="outline"
                  type="button"
                  :disabled="busy"
                  @click="act({ action: 'revoke_awb' }, 'Validasi resi dibatalkan')"
                >
                  Batalkan validasi
                </Button>
              </div>
            </form>

            <p v-if="order.warehouseStep === 'siap_pickup'" class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
              Siap pickup. Kurir boleh mengambil paket ini.
            </p>
          </section>

          <section class="space-y-2">
            <h3 class="text-sm font-semibold">Catatan masalah</h3>
            <Textarea v-model="problemDraft" placeholder="Kosongkan kalau tidak ada masalah" />
            <Button variant="outline" type="button" :disabled="busy" @click="act({ action: 'set_problem', note: problemDraft }, 'Catatan disimpan')">
              Simpan catatan
            </Button>
          </section>
        </div>
      </div>
      </ScrollArea>
  </div>
</template>
