<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckIcon, EyeIcon, EyeOffIcon, PackageIcon } from '@lucide/vue'
import { api } from '@/lib/api'

export interface SessionUser {
  email: string
  name: string
  phone: string
  role: 'admin' | 'staff'
}

const emit = defineEmits<{ ready: [user: SessionUser] }>()

const email = ref('')
const password = ref('')
const remember = ref(false)
const showPassword = ref(false)
const busy = ref(false)
const error = ref('')

const greeting = computed(() => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  if (hour < 11) return 'Selamat pagi'
  if (hour < 15) return 'Selamat siang'
  if (hour < 18) return 'Selamat sore'
  return 'Selamat malam'
})

async function submit() {
  error.value = ''
  busy.value = true
  try {
    const user = await api<SessionUser>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: email.value, password: password.value, remember: remember.value }),
    })
    emit('ready', user)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Gagal masuk'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="grid min-h-dvh bg-background lg:grid-cols-[minmax(340px,1.05fr)_minmax(380px,0.95fr)]">
    <section class="relative hidden min-h-dvh flex-col justify-between overflow-hidden border-r border-border bg-background px-12 pt-9 pb-7 text-foreground lg:flex">
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] bg-size-[22px_22px]" aria-hidden="true" />

      <div class="relative z-10 flex items-center gap-3">
        <span class="grid size-9 place-items-center rounded-xl bg-primary">
          <PackageIcon class="size-5 text-primary-foreground" />
        </span>
        <p class="text-base font-semibold">Proses order</p>
      </div>

      <div class="relative z-10 max-w-[460px]">
        <p class="mb-3.5 text-xs font-bold tracking-[1.6px] text-muted-foreground uppercase">{{ greeting }}</p>
        <h1 class="text-[clamp(40px,4vw,58px)] leading-[1.02] font-semibold tracking-[-1.8px]">
          Antrian gudang<br>
          <span class="text-muted-foreground">khusus untuk kamu.</span>
        </h1>
        <p class="mt-4 max-w-[380px] text-[15px] leading-relaxed text-muted-foreground">
          Cetak label, packing, dan validasi resi dalam satu tempat.
        </p>
      </div>

      <p class="relative z-10 text-xs text-muted-foreground">Proses order untuk gudang</p>
    </section>

    <div class="grid min-h-dvh place-items-center px-6 py-8">
      <form class="w-[min(420px,100%)] px-2" @submit.prevent="submit">
        <h1 class="text-[34px] leading-none font-extrabold tracking-[-1px] text-foreground">Selamat datang</h1>
        <p class="mt-2 text-sm leading-snug text-muted-foreground">Masuk untuk melanjutkan ke Proses order.</p>

        <label class="mt-7 flex flex-col">
          <span class="sr-only">Email</span>
          <span class="flex h-[52px] items-center rounded-full border border-border bg-card pr-2 pl-[18px] focus-within:border-foreground focus-within:shadow-[0_0_0_3px_var(--ring)]">
            <input v-model="email" class="h-full w-full border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" type="email" autocomplete="username" required placeholder="nama@perusahaan.com">
          </span>
        </label>

        <label class="mt-3.5 flex flex-col">
          <span class="sr-only">Kata sandi</span>
          <span class="flex h-[52px] items-center gap-2 rounded-full border border-border bg-card pr-2 pl-[18px] focus-within:border-foreground focus-within:shadow-[0_0_0_3px_var(--ring)]">
            <input v-model="password" class="h-full w-full border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" required placeholder="Masukkan password">
            <button class="grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted" type="button" :aria-label="showPassword ? 'Sembunyikan password' : 'Tampilkan password'" @click="showPassword = !showPassword">
              <EyeOffIcon v-if="showPassword" class="size-[18px]" />
              <EyeIcon v-else class="size-[18px]" />
            </button>
          </span>
        </label>

        <label class="mt-4 flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground" @click="remember = !remember">
          <span
            role="checkbox"
            tabindex="0"
            :aria-checked="remember"
            class="grid size-[18px] place-items-center rounded-[5px] border shadow-xs"
            :class="remember ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'"
            @keydown.space.prevent="remember = !remember"
            @keydown.enter.prevent="remember = !remember"
          >
            <CheckIcon v-if="remember" class="size-3" />
          </span>
          <span>Ingat saya</span>
        </label>

        <p v-if="error" class="mt-4 rounded-xl bg-[#fdf2ef] px-3.5 py-3 text-[13px] font-semibold text-[#9a4332]">{{ error }}</p>

        <button class="mt-[22px] h-[52px] w-full cursor-pointer rounded-full bg-primary text-[15px] font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" type="submit" :disabled="busy">
          {{ busy ? 'Memeriksa…' : 'Masuk' }}
        </button>
      </form>
    </div>
  </div>
</template>
