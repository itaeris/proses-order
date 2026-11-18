<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { RoutingRule } from '@/lib/types'

const rules = ref<RoutingRule[]>([])
const saving = ref(false)
const loaded = ref(false)

onMounted(async () => {
  try {
    const data = await api<{ rules: RoutingRule[] }>('/api/routing')
    rules.value = data.rules
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Gagal memuat peta kurir')
  } finally {
    loaded.value = true
  }
})

function addRule() {
  rules.value.push({ match: '', channel: 'biteship' })
}

function removeRule(index: number) {
  rules.value.splice(index, 1)
}

async function save() {
  saving.value = true
  try {
    const data = await api<{ rules: RoutingRule[] }>('/api/routing', {
      method: 'PUT',
      body: JSON.stringify({ rules: rules.value }),
    })
    rules.value = data.rules
    toast.success('Peta kurir disimpan. Order yang masih di antrian ikut diperbarui.')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Gagal menyimpan')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="rounded-xl border bg-card p-4 shadow-xs">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-base font-semibold">Peta metode kirim</h2>
      <div class="flex gap-2">
        <Button variant="outline" type="button" @click="addRule">Tambah</Button>
        <Button type="button" :disabled="saving" @click="save">Simpan</Button>
      </div>
    </div>
    <p class="mt-1 max-w-2xl text-sm text-muted-foreground">
      Order ke luar Indonesia, atau yang metode kirimnya mengandung DHL, masuk ke DHL.
      Sisanya dicocokkan dari atas ke bawah. Yang tidak cocok tetap di antrian Perlu dipilih.
    </p>

    <div class="mt-4 space-y-2">
      <div v-if="!loaded" class="space-y-2">
        <Skeleton v-for="index in 4" :key="index" class="h-9 w-full max-w-xl" />
      </div>
      <div v-for="(rule, index) in loaded ? rules : []" :key="index" class="flex items-center gap-2">
        <Input v-model="rule.match" placeholder="Kata di metode kirim, contoh JNE" class="max-w-sm" />
        <Select v-model="rule.channel">
          <SelectTrigger class="w-36 bg-background">
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="biteship">Biteship</SelectItem>
            <SelectItem value="indocolite">Indocolite</SelectItem>
            <SelectItem value="dhl">DHL</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" type="button" @click="removeRule(index)">Hapus</Button>
      </div>
      <p v-if="loaded && rules.length === 0" class="text-sm text-muted-foreground">Belum ada aturan. Order domestik akan masuk Perlu dipilih.</p>
    </div>
  </section>
</template>
