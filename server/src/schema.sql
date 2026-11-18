create table if not exists public.orders (
  id text primary key,
  name text not null,
  created_at text not null,
  customer_name text,
  total_amount text,
  currency text,
  financial_status text,
  fulfillment_status text,
  fulfill_by text,
  item_count integer not null default 0,
  items_json text not null default '[]',
  delivery_method text,
  shipping_country text,
  shipping_city text,
  shipping_address text,
  sales_channel text,
  tracking_number text,
  active smallint not null default 1,
  sync_run text,
  updated_at text not null
);

create table if not exists public.order_process (
  order_id text primary key references public.orders (id) on delete cascade,
  channel text not null default 'unassigned',
  channel_locked smallint not null default 0,
  indocolite_mode text,
  channel_step text not null default 'antrian',
  channel_done smallint not null default 0,
  warehouse_step text not null default 'print_label',
  awb_number text,
  awb_validated_at text,
  awb_validated_by text,
  assignee text,
  problem_note text,
  ready_at text,
  updated_at text not null
);

create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

create table if not exists public.sync_state (
  id smallint primary key check (id = 1),
  last_sync_at text,
  last_error text,
  last_count integer
);

alter table public.orders enable row level security;
alter table public.order_process enable row level security;
alter table public.app_settings enable row level security;
alter table public.sync_state enable row level security;

grant select, insert, update, delete on public.orders to anon, authenticated;
grant select, insert, update, delete on public.order_process to anon, authenticated;
grant select, insert, update, delete on public.app_settings to anon, authenticated;
grant select, insert, update, delete on public.sync_state to anon, authenticated;

drop policy if exists "app_access" on public.orders;
create policy "app_access" on public.orders for all to anon, authenticated using (true) with check (true);

drop policy if exists "app_access" on public.order_process;
create policy "app_access" on public.order_process for all to anon, authenticated using (true) with check (true);

drop policy if exists "app_access" on public.app_settings;
create policy "app_access" on public.app_settings for all to anon, authenticated using (true) with check (true);

drop policy if exists "app_access" on public.sync_state;
create policy "app_access" on public.sync_state for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
