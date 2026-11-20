<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'

interface Connection {
  id: 'shopify' | 'indocolite' | 'biteship' | 'dhl'
  name: string
  ok: boolean
  detail: string
  balance: number | null
}

const logos: Record<Connection['id'], string> = {
  shopify: '/logo/shopify.png',
  indocolite: '/logo/indocolite.webp?v=2',
  biteship: '/logo/biteship.png',
  dhl: '/logo/dhl.png',
}

const connections = ref<Connection[]>([])
const loading = ref(true)

onMounted(() => {
  void load()
})

function rupiah(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
}

async function load() {
  loading.value = true
  try {
    const data = await api<{ connections: Connection[] }>('/api/connections', undefined, { fresh: true })
    connections.value = data.connections
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Koneksi gagal dicek')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="rounded-xl border bg-card p-4 shadow-xs">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">Koneksi</h2>
        <p class="mt-1 text-sm text-muted-foreground">Cek apakah Shopify, Indocolite, Biteship, dan DHL masih menjawab.</p>
      </div>
      <Button type="button" variant="outline" class="cursor-pointer" :disabled="loading" @click="load">
        {{ loading ? 'Mengecek…' : 'Cek lagi' }}
      </Button>
    </div>

    <div v-if="loading && connections.length === 0" class="mt-4 grid gap-3 sm:grid-cols-2">
      <Skeleton v-for="index in 4" :key="index" class="h-28 rounded-xl" />
    </div>
    <div v-else class="mt-4 grid gap-3 sm:grid-cols-2">
      <article v-for="item in connections" :key="item.id" class="rounded-xl border p-4">
        <div class="flex items-center gap-3">
          <span class="grid h-14 w-20 shrink-0 place-items-center">
            <img :src="logos[item.id]" :alt="item.name" class="max-h-10 max-w-full object-contain" />
          </span>
          <div class="min-w-0">
            <p class="font-medium">{{ item.name }}</p>
            <p class="text-sm font-medium" :class="item.ok ? 'text-emerald-800' : 'text-rose-800'">
              {{ item.ok ? 'Aktif' : 'Bermasalah' }}
            </p>
            <p v-if="item.balance != null" class="text-sm font-semibold tabular-nums">Saldo {{ rupiah(item.balance) }}</p>
          </div>
        </div>
        <p v-if="item.id === 'dhl' && item.ok" class="mt-3 text-xs text-muted-foreground">DHL tidak menyimpan saldo. Tagihannya langsung ke akun.</p>
        <p v-else-if="item.detail !== 'Aktif'" class="mt-3 text-xs text-muted-foreground">{{ item.detail }}</p>
      </article>
    </div>
  </section>
</template>
