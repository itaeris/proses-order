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
  void act({ action: 'claim' }, 'Kamu memproses order ini')
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
      <header class="shrink-0 border-b px-4 py-3">
        <div class="flex flex-wrap items-center gap-3">
          <Button size="sm" type="button" @click="emit('close')">
            <ArrowLeftIcon />
            Antrian
          </Button>
          <h2 class="min-w-0 flex-1 truncate text-base font-semibold">
            <span class="font-mono">{{ order.name }}</span>
            <span class="text-muted-foreground"> — {{ order.customerName }}</span>
            <span v-if="order.shippingCity" class="text-muted-foreground"> — {{ order.shippingCity }}</span>
          </h2>
          <Badge variant="outline" :class="channelTone[order.channel]">{{ CHANNEL_LABEL[order.channel] }}</Badge>
          <Badge v-if="order.overdue" variant="destructive">Terlambat</Badge>
          <p class="text-sm">
            <span class="text-muted-foreground">Petugas</span>
            <span class="ml-2 font-medium">{{ order.assignee || 'Belum ada' }}</span>
          </p>
          <Button v-if="order.assignee" variant="outline" size="sm" type="button" :disabled="busy" @click="act({ action: 'release' })">
            Kosongkan
          </Button>
          <Button v-else size="sm" type="button" :disabled="busy" @click="claim">Proses</Button>
        </div>
      </header>

      <ScrollArea type="always" class="min-h-0 flex-1">
      <div class="grid items-start gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div class="space-y-4">
          <div class="grid gap-4 md:grid-cols-2">
            <section class="rounded-xl border bg-card p-4 shadow-xs">
              <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Pengirim</p>
              <p class="mt-2 text-sm font-medium">Gudang</p>
              <p class="mt-1 text-sm text-muted-foreground">Paket berangkat dari gudang.</p>
            </section>
            <section class="rounded-xl border bg-card p-4 shadow-xs">
              <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Penerima</p>
              <p class="mt-2 text-sm font-medium">{{ order.customerName }}</p>
              <p class="mt-1 text-sm">{{ order.shippingAddress || '—' }}</p>
            </section>
          </div>

          <section class="rounded-xl border bg-card p-4 shadow-xs">
            <h3 class="text-sm font-semibold">Barang</h3>
            <div class="mt-3 overflow-hidden rounded-lg border">
              <table class="w-full text-sm">
                <thead class="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th class="px-3 py-2 font-medium">Barang</th>
                    <th class="px-3 py-2 font-medium">SKU</th>
                    <th class="px-3 py-2 text-right font-medium">Jumlah</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, index) in order.items" :key="`${item.sku ?? item.name}-${index}`" class="border-t">
                    <td class="px-3 py-2">
                      <div class="flex items-center gap-3">
                        <img
                          v-if="item.imageUrl"
                          :src="thumb(item.imageUrl)"
                          :alt="item.name"
                          class="size-10 shrink-0 rounded-md border object-cover"
                        />
                        <div v-else class="size-10 shrink-0 rounded-md border bg-muted" />
                        <span>{{ item.name }}</span>
                      </div>
                    </td>
                    <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{{ item.sku || '—' }}</td>
                    <td class="px-3 py-2 text-right tabular-nums">{{ item.quantity }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="mt-3 text-right text-sm text-muted-foreground">
              {{ order.itemCount }} barang · <span class="font-medium text-foreground">{{ money(order.totalAmount, order.currency) }}</span>
            </p>
          </section>

          <section class="rounded-xl border bg-card p-4 shadow-xs">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">1. Gudang</h3>
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
            <p class="mt-1 text-xs text-muted-foreground">Cetak label, packing, lalu cek nomor resi.</p>
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
                Shopify sudah punya resi {{ order.trackingNumber }}. Tetap harus dicek sebelum pickup.
              </p>
              <p v-if="order.awbValidatedAt" class="text-xs text-emerald-800">
                Dicek {{ when(order.awbValidatedAt) }}<span v-if="order.awbValidatedBy"> oleh {{ order.awbValidatedBy }}</span>
              </p>
              <p v-else-if="order.channelDone" class="text-xs text-muted-foreground">
                Kurir belum boleh pickup sebelum resi ini dicek.
              </p>
              <p v-else class="text-xs text-muted-foreground">
                Resi bisa dicek sekarang. Siap pickup menyala setelah kurir juga selesai.
              </p>
              <div class="flex gap-2">
                <Button v-if="order.warehouseStep !== 'siap_pickup'" type="submit" :disabled="busy">Resi sudah dicek</Button>
                <Button
                  v-if="order.awbValidatedAt"
                  variant="outline"
                  type="button"
                  :disabled="busy"
                  @click="act({ action: 'revoke_awb' }, 'Pengecekan resi dibatalkan')"
                >
                  Batalkan cek
                </Button>
              </div>
            </form>

            <p v-if="order.warehouseStep === 'siap_pickup'" class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
              Siap pickup. Kurir boleh mengambil paket ini.
            </p>
          </section>

          <section class="rounded-xl border bg-card p-4 shadow-xs">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">2. Kurir</h3>
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
            <p class="mt-1 text-xs text-muted-foreground">
              Buat resi di kartu ini. Centang langkah hanya kalau resinya dikerjakan di luar aplikasi.
            </p>
            <p v-if="order.deliveryMethod" class="mt-3 text-sm font-medium">
              {{ order.deliveryMethod }}
              <span class="font-normal text-muted-foreground">· dari Shopify</span>
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
              variant="outline"
              type="button"
              :disabled="busy"
              @click="act({ action: 'advance_channel' }, 'Langkah kurir dicatat')"
            >
              Tandai {{ currentChannel?.label }} selesai
            </Button>
            <p v-else-if="order.needsMode" class="mt-3 text-sm text-muted-foreground">Pilih pengiriman manual atau otomatis.</p>
          </section>

        </div>

        <aside class="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-7.5rem)] xl:overflow-y-auto">
          <section class="rounded-xl border bg-card p-4 shadow-xs">
            <h3 class="text-sm font-semibold">Detail order</h3>
            <dl class="mt-3 space-y-2 text-sm">
              <div class="flex justify-between gap-3">
                <dt class="text-muted-foreground">Order</dt>
                <dd class="font-mono font-medium">{{ order.name }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted-foreground">Channel</dt>
                <dd>{{ CHANNEL_LABEL[order.channel] }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted-foreground">Kirim</dt>
                <dd class="text-right">{{ order.deliveryMethod || '—' }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted-foreground">Batas</dt>
                <dd>{{ when(order.fulfillBy) }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted-foreground">Resi</dt>
                <dd class="font-mono">{{ order.awbNumber || order.trackingNumber || '—' }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted-foreground">Total</dt>
                <dd class="font-medium">{{ money(order.totalAmount, order.currency) }}</dd>
              </div>
            </dl>
          </section>
          <section class="space-y-2 rounded-xl border bg-card p-4 shadow-xs">
            <h3 class="text-sm font-semibold">Catatan</h3>
            <Textarea v-model="problemDraft" placeholder="Isi kalau ada masalah. Kosongkan kalau tidak ada." />
            <Button variant="outline" type="button" :disabled="busy" @click="act({ action: 'set_problem', note: problemDraft }, 'Catatan disimpan')">
              Simpan catatan
            </Button>
          </section>
        </aside>
      </div>
      </ScrollArea>
  </div>
</template>
