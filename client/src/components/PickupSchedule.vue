<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon } from '@lucide/vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const date = defineModel<string>('date', { required: true })
const time = defineModel<string>('time', { required: true })
const vehicle = defineModel<string>('vehicle', { required: true })

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const HOURS = Array.from({ length: 11 }, (_, index) => String(index + 8).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']
const VEHICLES = ['Motor', 'Mobil', 'Truk']

const dateOpen = ref(false)
const timeOpen = ref(false)
const viewYear = ref(todayParts().year)
const viewMonth = ref(todayParts().month)

const dateLabel = computed(() => {
  const [year, month, day] = date.value.split('-')
  if (!year || !month || !day) return 'Pilih tanggal'
  return `${day}/${month}/${year}`
})

const hour = computed(() => time.value.slice(0, 2) || '10')
const minute = computed(() => time.value.slice(3, 5) || '00')
const minuteChoices = computed(() => (hour.value === '18' ? ['00'] : MINUTES))

const cells = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const count = new Date(viewYear.value, viewMonth.value, 0).getDate()
  const days: Array<{ iso: string; label: number } | null> = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= count; day += 1) days.push({ iso: iso(viewYear.value, viewMonth.value, day), label: day })
  return days
})

watch(dateOpen, (open) => {
  if (!open) return
  const [year, month] = date.value.split('-').map(Number)
  if (year && month) {
    viewYear.value = year
    viewMonth.value = month
  }
})

function todayParts() {
  const [year, month, day] = jakartaToday().split('-').map(Number)
  return { year, month, day }
}

function jakartaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function shiftMonth(delta: number) {
  const next = new Date(viewYear.value, viewMonth.value - 1 + delta, 1)
  viewYear.value = next.getFullYear()
  viewMonth.value = next.getMonth() + 1
}

function pickDate(value: string) {
  if (value < jakartaToday()) return
  date.value = value
  dateOpen.value = false
}

function pickHour(value: string) {
  const nextMinute = value === '18' ? '00' : minute.value
  time.value = `${value}:${MINUTES.includes(nextMinute) ? nextMinute : '00'}`
}

function pickMinute(value: string) {
  time.value = `${hour.value}:${value}`
  timeOpen.value = false
}
</script>

<template>
  <div class="grid grid-cols-3 gap-2">
    <PopoverRoot v-model:open="dateOpen">
      <PopoverTrigger as-child>
        <button type="button" class="flex h-8 w-full cursor-pointer items-center justify-between gap-1 rounded-md border bg-background px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
          <span>{{ dateLabel }}</span>
          <CalendarIcon class="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent side="bottom" align="start" :side-offset="4" class="z-50 w-64 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
          <div class="mb-2 flex items-center justify-between">
            <button type="button" class="grid size-7 cursor-pointer place-items-center rounded-md hover:bg-muted" aria-label="Bulan sebelumnya" @click="shiftMonth(-1)">
              <ChevronLeftIcon class="size-4" />
            </button>
            <p class="text-sm font-medium">{{ MONTHS[viewMonth - 1] }} {{ viewYear }}</p>
            <button type="button" class="grid size-7 cursor-pointer place-items-center rounded-md hover:bg-muted" aria-label="Bulan berikutnya" @click="shiftMonth(1)">
              <ChevronRightIcon class="size-4" />
            </button>
          </div>
          <div class="grid grid-cols-7 gap-0.5 text-center text-[11px] text-muted-foreground">
            <span v-for="name in WEEKDAYS" :key="name" class="py-1">{{ name }}</span>
          </div>
          <div class="grid grid-cols-7 gap-0.5">
            <span v-for="(cell, index) in cells" :key="index">
              <button
                v-if="cell"
                type="button"
                class="grid h-8 w-full cursor-pointer place-items-center rounded-md text-xs disabled:cursor-not-allowed disabled:text-muted-foreground/40"
                :class="cell.iso === date ? 'bg-primary font-medium text-primary-foreground' : cell.iso === jakartaToday() ? 'ring-1 ring-border' : 'hover:bg-muted'"
                :disabled="cell.iso < jakartaToday()"
                @click="pickDate(cell.iso)"
              >
                {{ cell.label }}
              </button>
            </span>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>

    <PopoverRoot v-model:open="timeOpen">
      <PopoverTrigger as-child>
        <button type="button" class="flex h-8 w-full cursor-pointer items-center justify-between gap-1 rounded-md border bg-background px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
          <span class="font-mono">{{ time }}</span>
          <ClockIcon class="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent side="bottom" align="start" :side-offset="4" class="z-50 flex max-h-56 w-36 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
          <div class="flex-1 overflow-y-auto p-1">
            <button
              v-for="value in HOURS"
              :key="value"
              type="button"
              class="flex h-7 w-full cursor-pointer items-center justify-center rounded-md font-mono text-xs"
              :class="value === hour ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
              @click="pickHour(value)"
            >
              {{ value }}
            </button>
          </div>
          <div class="flex-1 overflow-y-auto border-l p-1">
            <button
              v-for="value in minuteChoices"
              :key="value"
              type="button"
              class="flex h-7 w-full cursor-pointer items-center justify-center rounded-md font-mono text-xs"
              :class="value === minute ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
              @click="pickMinute(value)"
            >
              {{ value }}
            </button>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>

    <Select v-model="vehicle">
      <SelectTrigger size="sm" class="w-full min-w-0 cursor-pointer text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem v-for="item in VEHICLES" :key="item" :value="item" class="cursor-pointer">{{ item }}</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
