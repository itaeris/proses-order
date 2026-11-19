<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ArrowLeftIcon, PencilIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import type { SessionUser } from '@/components/LoginPage.vue'

const props = defineProps<{ admin: boolean; account: SessionUser | null }>()
const emit = defineEmits<{ back: []; updated: [user: SessionUser] }>()

const profileName = ref('')
const profileEmail = ref('')
const profilePhone = ref('')
const savingProfile = ref(false)

const currentPassword = ref('')
const nextPassword = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)

const name = ref('')
const email = ref('')
const password = ref('')
const creating = ref(false)
const users = ref<SessionUser[]>([])
const editingEmail = ref('')
const editName = ref('')
const editEmail = ref('')
const editPhone = ref('')
const editRole = ref<'admin' | 'staff'>('staff')
const editPassword = ref('')
const savingEdit = ref(false)
const tab = ref('profile')

watch(
  () => props.account,
  (account) => {
    profileName.value = account?.name ?? ''
    profileEmail.value = account?.email ?? ''
    profilePhone.value = account?.phone ?? ''
  },
  { immediate: true },
)

onMounted(() => {
  if (props.admin) void loadUsers()
})

async function saveProfile() {
  savingProfile.value = true
  try {
    const next = await api<SessionUser>('/api/account/profile', {
      method: 'POST',
      body: JSON.stringify({ name: profileName.value, email: profileEmail.value, phone: profilePhone.value }),
    })
    emit('updated', next)
    toast.success('Profil diperbarui')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Profil gagal diperbarui')
  } finally {
    savingProfile.value = false
  }
}

async function loadUsers() {
  users.value = await api<SessionUser[]>('/api/users')
}

async function savePassword() {
  if (nextPassword.value !== confirmPassword.value) {
    toast.error('Ulangan kata sandi tidak sama')
    return
  }
  savingPassword.value = true
  try {
    await api('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: currentPassword.value, nextPassword: nextPassword.value }),
    })
    currentPassword.value = ''
    nextPassword.value = ''
    confirmPassword.value = ''
    toast.success('Kata sandi diperbarui')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Kata sandi gagal diperbarui')
  } finally {
    savingPassword.value = false
  }
}

function startEdit(account: SessionUser) {
  editingEmail.value = account.email
  editName.value = account.name
  editEmail.value = account.email
  editPhone.value = account.phone ?? ''
  editRole.value = account.role
  editPassword.value = ''
}

async function saveEdit() {
  savingEdit.value = true
  try {
    const next = await api<SessionUser>('/api/users/update', {
      method: 'POST',
      body: JSON.stringify({
        currentEmail: editingEmail.value,
        name: editName.value,
        email: editEmail.value,
        phone: editPhone.value,
        role: editRole.value,
        password: editPassword.value,
      }),
    })
    if (props.account?.email === editingEmail.value) emit('updated', next)
    editingEmail.value = ''
    toast.success('Pengguna diperbarui')
    await loadUsers()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Pengguna gagal diperbarui')
  } finally {
    savingEdit.value = false
  }
}

async function createUser() {
  creating.value = true
  try {
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name: name.value, email: email.value, password: password.value }),
    })
    name.value = ''
    email.value = ''
    password.value = ''
    toast.success('Pengguna dibuat')
    await loadUsers()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Pengguna gagal dibuat')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <Tabs v-model="tab" class="min-h-0 w-full flex-1">
    <div class="flex shrink-0 items-center gap-2 self-start">
      <Button size="sm" variant="outline" type="button" @click="emit('back')">
        <ArrowLeftIcon />
        Beranda
      </Button>
      <TabsList>
        <TabsTrigger value="profile">Profil</TabsTrigger>
        <TabsTrigger v-if="admin" value="users">Pengguna</TabsTrigger>
      </TabsList>
    </div>

    <TabsContent value="profile" class="mt-0 flex-none">
      <div class="grid items-start gap-4 lg:grid-cols-2">
        <form class="space-y-3 rounded-xl border bg-card p-4 shadow-xs" @submit.prevent="saveProfile">
          <div class="space-y-1.5">
            <Label for="profile-name">Nama</Label>
            <Input id="profile-name" v-model="profileName" autocomplete="name" required />
          </div>
          <div class="space-y-1.5">
            <Label for="profile-email">Email</Label>
            <Input id="profile-email" v-model="profileEmail" type="email" autocomplete="email" required />
          </div>
          <div class="space-y-1.5">
            <Label for="profile-phone">Nomor</Label>
            <Input id="profile-phone" v-model="profilePhone" type="tel" autocomplete="tel" />
          </div>
          <Button type="submit" :disabled="savingProfile">Simpan profil</Button>
        </form>
        <form class="space-y-3 rounded-xl border bg-card p-4 shadow-xs" @submit.prevent="savePassword">
          <div class="space-y-1.5">
            <Label for="current-password">Kata sandi sekarang</Label>
            <Input id="current-password" v-model="currentPassword" type="password" autocomplete="current-password" required />
          </div>
          <div class="space-y-1.5">
            <Label for="next-password">Kata sandi baru</Label>
            <Input id="next-password" v-model="nextPassword" type="password" autocomplete="new-password" required />
          </div>
          <div class="space-y-1.5">
            <Label for="confirm-password">Ulangi kata sandi baru</Label>
            <Input id="confirm-password" v-model="confirmPassword" type="password" autocomplete="new-password" required />
          </div>
          <Button type="submit" :disabled="savingPassword">Simpan kata sandi</Button>
        </form>
      </div>
    </TabsContent>

    <TabsContent v-if="admin" value="users" class="mt-0 flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
      <form class="flex shrink-0 flex-wrap items-end gap-2 border-b p-3" @submit.prevent="createUser">
        <div class="min-w-40 flex-1 space-y-1.5">
          <Label for="user-name">Nama</Label>
          <Input id="user-name" v-model="name" autocomplete="off" required />
        </div>
        <div class="min-w-48 flex-1 space-y-1.5">
          <Label for="user-email">Email</Label>
          <Input id="user-email" v-model="email" type="email" autocomplete="off" required />
        </div>
        <div class="min-w-40 flex-1 space-y-1.5">
          <Label for="user-password">Kata sandi</Label>
          <Input id="user-password" v-model="password" type="password" autocomplete="new-password" required />
        </div>
        <Button type="submit" :disabled="creating">Buat pengguna</Button>
      </form>
      <form v-if="editingEmail" class="flex shrink-0 flex-wrap items-end gap-2 border-b bg-muted/40 p-3" @submit.prevent="saveEdit">
        <div class="min-w-40 flex-1 space-y-1.5">
          <Label for="edit-name">Nama</Label>
          <Input id="edit-name" v-model="editName" autocomplete="off" required />
        </div>
        <div class="min-w-48 flex-1 space-y-1.5">
          <Label for="edit-email">Email</Label>
          <Input id="edit-email" v-model="editEmail" type="email" autocomplete="off" required />
        </div>
        <div class="min-w-36 flex-1 space-y-1.5">
          <Label for="edit-phone">Nomor</Label>
          <Input id="edit-phone" v-model="editPhone" type="tel" autocomplete="off" />
        </div>
        <div class="w-36 space-y-1.5">
          <Label>Peran</Label>
          <Select v-model="editRole">
            <SelectTrigger class="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="staff">Petugas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="min-w-40 flex-1 space-y-1.5">
          <Label for="edit-password">Kata sandi baru</Label>
          <Input id="edit-password" v-model="editPassword" type="password" autocomplete="new-password" placeholder="Kosongkan jika tetap" />
        </div>
        <Button type="button" variant="outline" :disabled="savingEdit" @click="editingEmail = ''">Batal</Button>
        <Button type="submit" :disabled="savingEdit">Simpan</Button>
      </form>
      <div class="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Email</TableHead>
              <TableHead class="w-28">Peran</TableHead>
              <TableHead class="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="account in users" :key="account.email">
              <TableCell>{{ account.name }}</TableCell>
              <TableCell>{{ account.email }}</TableCell>
              <TableCell class="text-muted-foreground">{{ account.role === 'admin' ? 'Admin' : 'Petugas' }}</TableCell>
              <TableCell class="text-right">
                <Button size="sm" variant="outline" type="button" @click="startEdit(account)">
                  <PencilIcon />
                  Edit
                </Button>
              </TableCell>
            </TableRow>
            <TableRow v-if="users.length === 0">
              <TableCell colspan="4" class="py-10 text-center text-muted-foreground">Belum ada pengguna.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </TabsContent>
  </Tabs>
</template>
