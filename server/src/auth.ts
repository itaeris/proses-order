import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Request, Response } from 'express'
import { deleteSetting, getSetting, listSettings, setSetting } from './db.js'
import { ClientError } from './orders.js'

const scryptAsync = promisify(scrypt)
const COOKIE = 'proses_session'
const SESSION_MS = 14 * 24 * 60 * 60 * 1000
const ADMIN_EMAIL = 'it@aerisbeaute.com'
const ADMIN_PASSWORD = 'aerisbeaute'

export class AuthError extends Error {
  status = 401
}

export interface PublicUser {
  email: string
  name: string
  phone: string
  role: 'admin' | 'staff'
}

interface StoredUser extends PublicUser {
  passwordHash: string
  createdAt: string
}

interface StoredSession {
  email: string
  expiresAt: string
}

export async function ensureAdmin() {
  if (await getSetting(userKey(ADMIN_EMAIL))) return
  await setSetting(userKey(ADMIN_EMAIL), JSON.stringify(await account(ADMIN_EMAIL, 'IT', 'admin', ADMIN_PASSWORD)))
}

export async function login(email: string, password: string, remember = false) {
  const user = await readUser(email)
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AuthError('Email atau kata sandi salah')
  }
  const token = randomBytes(32).toString('base64url')
  const session: StoredSession = {
    email: user.email,
    expiresAt: new Date(Date.now() + SESSION_MS).toISOString(),
  }
  await setSetting(sessionKey(token), JSON.stringify(session))
  return { token, user: publicUser(user), remember }
}

export async function logout(token: string) {
  if (!token) return
  await deleteSetting(sessionKey(token))
}

export async function currentUser(req: Request): Promise<PublicUser | null> {
  const token = readCookie(req, COOKIE)
  if (!token) return null
  const raw = await getSetting(sessionKey(token))
  if (!raw) return null
  let session: StoredSession
  try {
    session = JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
  if (!session.expiresAt || Date.parse(session.expiresAt) < Date.now()) {
    await deleteSetting(sessionKey(token))
    return null
  }
  const user = await readUser(session.email)
  return user ? publicUser(user) : null
}

export async function changePassword(email: string, currentPassword: string, nextPassword: string) {
  const user = await readUser(email)
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ClientError('Kata sandi sekarang salah')
  }
  assertPassword(nextPassword)
  user.passwordHash = await hashPassword(nextPassword)
  await setSetting(userKey(user.email), JSON.stringify(user))
}

export async function updateProfile(currentEmail: string, input: { name: string; email: string; phone: string }) {
  const user = await readUser(currentEmail)
  if (!user) throw new ClientError('Pengguna tidak ditemukan')
  const name = input.name.trim()
  if (name.length < 2) throw new ClientError('Isi nama')
  const email = normalizeEmail(input.email)
  if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) {
    throw new ClientError('Email tidak valid')
  }
  const phone = normalizePhone(input.phone)
  if (email !== user.email && (await getSetting(userKey(email)))) throw new ClientError('Email itu sudah dipakai')
  const previous = user.email
  user.name = name
  user.email = email
  user.phone = phone
  await setSetting(userKey(email), JSON.stringify(user))
  if (email !== previous) {
    await deleteSetting(userKey(previous))
    await retargetSessions(previous, email)
  }
  return publicUser(user)
}

export async function updateUser(
  currentEmail: string,
  input: { name: string; email: string; phone: string; role: string; password?: string },
) {
  const user = await readUser(currentEmail)
  if (!user) throw new ClientError('Pengguna tidak ditemukan')
  const name = input.name.trim()
  if (name.length < 2) throw new ClientError('Isi nama')
  const email = normalizeEmail(input.email)
  if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) {
    throw new ClientError('Email tidak valid')
  }
  const phone = normalizePhone(input.phone)
  if (input.role !== 'admin' && input.role !== 'staff') throw new ClientError('Peran tidak dikenal')
  if (user.role === 'admin' && input.role !== 'admin') {
    const admins = (await listUsers()).filter((item) => item.role === 'admin')
    if (admins.length <= 1) throw new ClientError('Harus tetap ada satu admin')
  }
  if (email !== user.email && (await getSetting(userKey(email)))) throw new ClientError('Email itu sudah dipakai')
  const password = (input.password ?? '').trim()
  if (password) {
    assertPassword(password)
    user.passwordHash = await hashPassword(password)
  }
  const previous = user.email
  user.name = name
  user.email = email
  user.phone = phone
  user.role = input.role
  await setSetting(userKey(email), JSON.stringify(user))
  if (email !== previous) {
    await deleteSetting(userKey(previous))
    await retargetSessions(previous, email)
  }
  return publicUser(user)
}

export async function createUser(input: { email: string; name: string; password: string }) {
  const email = normalizeEmail(input.email)
  if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) {
    throw new ClientError('Email tidak valid')
  }
  const name = input.name.trim()
  if (name.length < 2) throw new ClientError('Isi nama pengguna')
  assertPassword(input.password)
  if (await getSetting(userKey(email))) throw new ClientError('Email itu sudah dipakai')
  const user = await account(email, name, 'staff', input.password)
  await setSetting(userKey(email), JSON.stringify(user))
  return publicUser(user)
}

export async function listUsers(): Promise<PublicUser[]> {
  const rows = await listSettings('user:')
  const users: PublicUser[] = []
  for (const row of rows) {
    try {
      users.push(publicUser(JSON.parse(row.value) as StoredUser))
    } catch {
      continue
    }
  }
  return users.sort((a, b) => a.email.localeCompare(b.email))
}

export function writeSession(res: Response, token: string, remember = false) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.VERCEL === '1',
    path: '/',
    ...(remember ? { maxAge: SESSION_MS } : {}),
  })
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.VERCEL === '1',
    path: '/',
  })
}

export function signedIn(res: Response): PublicUser {
  return res.locals.user as PublicUser
}

function publicUser(user: StoredUser): PublicUser {
  return { email: user.email, name: user.name, phone: user.phone ?? '', role: user.role }
}

async function account(email: string, name: string, role: PublicUser['role'], password: string): Promise<StoredUser> {
  return {
    email,
    name,
    phone: '',
    role,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  }
}

async function readUser(email: string): Promise<StoredUser | null> {
  const raw = await getSetting(userKey(email))
  if (!raw) return null
  try {
    const user = JSON.parse(raw) as StoredUser
    if (!user.email || !user.passwordHash) return null
    return user
  } catch {
    return null
  }
}

function userKey(email: string) {
  return `user:${normalizeEmail(email)}`
}

function sessionKey(token: string) {
  return `session:${createHash('sha256').update(token).digest('base64url')}`
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function normalizePhone(phone: string) {
  const value = phone.trim()
  if (!value) return ''
  if (!/^[0-9+\-\s()]{8,20}$/.test(value)) throw new ClientError('Nomor tidak valid')
  return value
}

async function retargetSessions(from: string, to: string) {
  const previous = normalizeEmail(from)
  for (const row of await listSettings('session:')) {
    try {
      const session = JSON.parse(row.value) as StoredSession
      if (normalizeEmail(session.email) !== previous) continue
      session.email = to
      await setSetting(row.key, JSON.stringify(session))
    } catch {
      continue
    }
  }
}

function assertPassword(password: string) {
  if (password.trim().length < 8) throw new ClientError('Kata sandi minimal 8 karakter')
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const hash = (await scryptAsync(password, salt, 32)) as Buffer
  return `scrypt:${salt}:${hash.toString('base64url')}`
}

async function verifyPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split(':')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const next = (await scryptAsync(password, salt, 32)) as Buffer
  const prev = Buffer.from(hash, 'base64url')
  if (next.length !== prev.length) return false
  return timingSafeEqual(next, prev)
}

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie
  if (!header) return ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}
