import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_RULES, type RoutingRule } from './flow.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
dotenv.config({ path: path.join(root, '.env') })

const url = process.env.SUPABASE_URL?.trim() ?? ''
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY)?.trim() ?? ''
if (!url || !key) {
  throw new Error('Isi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY di file .env')
}

const supabase: SupabaseClient = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const orderColumns =
  'id,name,created_at,customer_name,total_amount,currency,financial_status,fulfillment_status,fulfill_by,item_count,items_json,delivery_method,shipping_country,shipping_city,shipping_address,sales_channel,tracking_number,active,sync_run,updated_at'
const processColumns =
  'order_id,channel,channel_locked,indocolite_mode,channel_step,channel_done,warehouse_step,awb_number,awb_validated_at,awb_validated_by,assignee,problem_note,ready_at,updated_at'
const joinedSelect = `${orderColumns},order_process!inner(${processColumns})`

export interface OrderRow {
  id: string
  name: string
  created_at: string
  customer_name: string | null
  total_amount: string | null
  currency: string | null
  financial_status: string | null
  fulfillment_status: string | null
  fulfill_by: string | null
  item_count: number
  items_json: string
  delivery_method: string | null
  shipping_country: string | null
  shipping_city: string | null
  shipping_address: string | null
  sales_channel: string | null
  tracking_number: string | null
  active: number
  sync_run: string | null
  updated_at: string
}

export interface ProcessRow {
  order_id: string
  channel: string
  channel_locked: number
  indocolite_mode: string | null
  channel_step: string
  channel_done: number
  warehouse_step: string
  awb_number: string | null
  awb_validated_at: string | null
  awb_validated_by: string | null
  assignee: string | null
  problem_note: string | null
  ready_at: string | null
  updated_at: string
}

export interface JoinedRow extends OrderRow, ProcessRow {}

export interface SyncState {
  last_sync_at: string | null
  last_error: string | null
  last_count: number | null
}

function fail(error: { message: string } | null) {
  if (!error) return
  if (/schema cache|could not find the table/i.test(error.message)) {
    throw new Error('Tabel Supabase belum ada. Jalankan server/src/schema.sql di SQL Editor project ini.')
  }
  throw new Error(error.message)
}

function text(value: unknown): string | null {
  if (value == null) return null
  return String(value)
}

function flatten(row: Record<string, unknown>): JoinedRow | null {
  const embedded = row.order_process
  const process = (Array.isArray(embedded) ? embedded[0] : embedded) as Record<string, unknown> | null
  if (!process) return null
  return {
    id: String(row.id),
    name: String(row.name),
    created_at: String(row.created_at),
    customer_name: text(row.customer_name),
    total_amount: text(row.total_amount),
    currency: text(row.currency),
    financial_status: text(row.financial_status),
    fulfillment_status: text(row.fulfillment_status),
    fulfill_by: text(row.fulfill_by),
    item_count: Number(row.item_count ?? 0),
    items_json: String(row.items_json ?? '[]'),
    delivery_method: text(row.delivery_method),
    shipping_country: text(row.shipping_country),
    shipping_city: text(row.shipping_city),
    shipping_address: text(row.shipping_address),
    sales_channel: text(row.sales_channel),
    tracking_number: text(row.tracking_number),
    active: Number(row.active ?? 0),
    sync_run: text(row.sync_run),
    updated_at: String(row.updated_at),
    order_id: String(process.order_id),
    channel: String(process.channel),
    channel_locked: Number(process.channel_locked ?? 0),
    indocolite_mode: text(process.indocolite_mode),
    channel_step: String(process.channel_step),
    channel_done: Number(process.channel_done ?? 0),
    warehouse_step: String(process.warehouse_step),
    awb_number: text(process.awb_number),
    awb_validated_at: text(process.awb_validated_at),
    awb_validated_by: text(process.awb_validated_by),
    assignee: text(process.assignee),
    problem_note: text(process.problem_note),
    ready_at: text(process.ready_at),
  }
}

export async function listJoined(): Promise<JoinedRow[]> {
  const { data, error } = await supabase.from('orders').select(joinedSelect).limit(5000)
  fail(error)
  return (data ?? []).map((row) => flatten(row as Record<string, unknown>)).filter((row): row is JoinedRow => row !== null)
}

export async function getJoined(id: string): Promise<JoinedRow | undefined> {
  const { data, error } = await supabase.from('orders').select(joinedSelect).eq('id', id).maybeSingle()
  fail(error)
  if (!data) return undefined
  return flatten(data as Record<string, unknown>) ?? undefined
}

export async function getRules(): Promise<RoutingRule[]> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'routing_rules').maybeSingle()
  fail(error)
  if (!data?.value) return DEFAULT_RULES
  try {
    const parsed = JSON.parse(data.value) as RoutingRule[]
    if (!Array.isArray(parsed)) return DEFAULT_RULES
    return parsed
  } catch {
    return DEFAULT_RULES
  }
}

export async function saveRules(rules: RoutingRule[]) {
  const { error } = await supabase.from('app_settings').upsert({ key: 'routing_rules', value: JSON.stringify(rules) })
  fail(error)
}

export async function getSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle()
  fail(error)
  return data?.value ?? null
}

export async function setSetting(key: string, value: string) {
  const { error } = await supabase.from('app_settings').upsert({ key, value })
  fail(error)
}

export async function getSyncState(): Promise<SyncState> {
  const { data, error } = await supabase
    .from('sync_state')
    .select('last_sync_at, last_error, last_count')
    .eq('id', 1)
    .maybeSingle()
  fail(error)
  return {
    last_sync_at: data?.last_sync_at ?? null,
    last_error: data?.last_error ?? null,
    last_count: data?.last_count ?? null,
  }
}

export async function setSyncState(patch: Partial<SyncState>) {
  const current = await getSyncState()
  const { error } = await supabase.from('sync_state').upsert({
    id: 1,
    last_sync_at: patch.last_sync_at === undefined ? current.last_sync_at : patch.last_sync_at,
    last_error: patch.last_error === undefined ? current.last_error : patch.last_error,
    last_count: patch.last_count === undefined ? current.last_count : patch.last_count,
  })
  fail(error)
}

export async function updateProcess(row: ProcessRow) {
  const { error } = await supabase
    .from('order_process')
    .update({
      channel: row.channel,
      channel_locked: row.channel_locked,
      indocolite_mode: row.indocolite_mode,
      channel_step: row.channel_step,
      channel_done: row.channel_done,
      warehouse_step: row.warehouse_step,
      awb_number: row.awb_number,
      awb_validated_at: row.awb_validated_at,
      awb_validated_by: row.awb_validated_by,
      assignee: row.assignee,
      problem_note: row.problem_note,
      ready_at: row.ready_at,
      updated_at: row.updated_at,
    })
    .eq('order_id', row.order_id)
  fail(error)
}

export async function upsertOrders(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return
  const { error } = await supabase.from('orders').upsert(rows, { onConflict: 'id' })
  fail(error)
}

export async function existingProcessIds(ids: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (let index = 0; index < ids.length; index += 100) {
    const slice = ids.slice(index, index + 100)
    if (slice.length === 0) continue
    const { data, error } = await supabase.from('order_process').select('order_id').in('order_id', slice)
    fail(error)
    for (const row of data ?? []) found.add(String(row.order_id))
  }
  return found
}

export async function insertProcessRows(rows: ProcessRow[]) {
  if (rows.length === 0) return
  const { error } = await supabase.from('order_process').insert(rows)
  fail(error)
}

export async function deactivateOtherRuns(syncRun: string) {
  const { error } = await supabase
    .from('orders')
    .update({ active: 0, updated_at: new Date().toISOString() })
    .or(`sync_run.is.null,sync_run.neq.${syncRun}`)
  fail(error)
}

export async function countOrders(): Promise<number> {
  const { count, error } = await supabase.from('orders').select('id', { count: 'exact', head: true })
  fail(error)
  return count ?? 0
}

export async function countSample(): Promise<number> {
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('active', 1)
    .eq('sync_run', 'sample')
  fail(error)
  return count ?? 0
}

async function ensureDefaults() {
  const { data, error } = await supabase.from('app_settings').select('key').eq('key', 'routing_rules').maybeSingle()
  fail(error)
  if (!data) await saveRules(DEFAULT_RULES)
  const state = await supabase.from('sync_state').select('id').eq('id', 1).maybeSingle()
  fail(state.error)
  if (!state.data) {
    const { error: insertError } = await supabase.from('sync_state').insert({
      id: 1,
      last_sync_at: null,
      last_error: null,
      last_count: null,
    })
    fail(insertError)
  }
}

type SqliteDatabase = {
  prepare: (sql: string) => { all: () => Array<Record<string, unknown>> }
  close: () => void
}

async function openSqlite(file: string): Promise<SqliteDatabase | null> {
  if (process.env.VERCEL) return null
  try {
    const load = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<{ DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase }>
    const { DatabaseSync } = await load('node:sqlite')
    return new DatabaseSync(file, { readOnly: true })
  } catch {
    return null
  }
}

async function sqliteRows(file: string, sql: string): Promise<Array<Record<string, unknown>> | null> {
  const db = await openSqlite(file)
  if (!db) return null
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}

async function importSqliteIfEmpty() {
  if ((await countOrders()) > 0) return
  const file = path.join(root, 'data', 'proses-order.sqlite')
  if (!fs.existsSync(file)) return
  const orders = await sqliteRows(file, 'SELECT * FROM orders')
  if (!orders || orders.length === 0) return
  await upsertOrders(orders)
  const processes = (await sqliteRows(file, 'SELECT * FROM process')) as ProcessRow[] | null
  if (processes && processes.length > 0) await insertProcessRows(processes)
  const settings = await sqliteRows(file, 'SELECT key, value FROM settings')
  if (settings && settings.length > 0) {
    const { error } = await supabase.from('app_settings').upsert(settings)
    fail(error)
  }
  const syncRows = await sqliteRows(file, 'SELECT id, last_sync_at, last_error, last_count FROM sync_state')
  if (syncRows && syncRows.length > 0) {
    const { error } = await supabase.from('sync_state').upsert(syncRows)
    fail(error)
  }
}

export async function ensureDatabase() {
  const probe = await supabase.from('orders').select('id').limit(1)
  fail(probe.error)
  await importSqliteIfEmpty()
  await ensureDefaults()
}
