-- Module hôtel : types de chambres, chambres, tarifs dynamiques, clients, réservations, suppléments, paiements.
-- Montants en Ariary (entiers). Les statuts « en temps réel » des chambres sont calculés, jamais stockés.

create type hotel_res_status as enum ('option', 'confirmed', 'checked_in', 'checked_out', 'cancelled');

create table hotel_room_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#3b82f6',
  base_price integer not null default 0 check (base_price >= 0),
  capacity integer not null default 2 check (capacity >= 1),
  sort_order integer not null default 0
);
create unique index hotel_room_types_name_key on hotel_room_types (lower(name));

create table hotel_rooms (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  room_type_id uuid not null references hotel_room_types(id) on delete restrict,
  capacity integer check (capacity is null or capacity >= 1),
  price integer check (price is null or price >= 0),
  tech_status text not null default 'normal' check (tech_status in ('normal', 'cleaning', 'maintenance', 'out_of_service')),
  is_active boolean not null default true,
  notes text,
  sort_order integer not null default 0
);
create unique index hotel_rooms_number_key on hotel_rooms (lower(number));

create table hotel_rate_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  room_type_id uuid references hotel_room_types(id) on delete cascade,
  date_from date not null,
  date_to date not null,
  mode text not null check (mode in ('fixed', 'percent')),
  value integer not null,
  weekdays smallint[],
  priority integer not null default 0,
  is_active boolean not null default true,
  check (date_to >= date_from)
);

create table hotel_clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  id_document text,
  address text,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index hotel_clients_name_idx on hotel_clients (lower(full_name));

create table hotel_services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit_price integer not null default 0 check (unit_price >= 0),
  charge_mode text not null default 'flat' check (charge_mode in ('flat', 'per_night')),
  is_active boolean not null default true,
  sort_order integer not null default 0
);
create unique index hotel_services_name_key on hotel_services (lower(name));

create sequence hotel_reservation_seq;

create table hotel_reservations (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  group_id uuid,
  client_id uuid not null references hotel_clients(id) on delete restrict,
  room_id uuid not null references hotel_rooms(id) on delete restrict,
  arrival date not null,
  departure date not null,
  adults integer not null default 1 check (adults >= 1),
  children integer not null default 0 check (children >= 0),
  price_per_night integer not null check (price_per_night >= 0),
  discount_percent numeric(5,2) not null default 0,
  discount_amount integer not null default 0 check (discount_amount >= 0),
  tourist_tax integer not null default 0,
  status hotel_res_status not null default 'confirmed',
  note text,
  cancel_reason text,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (departure > arrival)
);
create index hotel_reservations_room_idx on hotel_reservations (room_id, arrival, departure);
create index hotel_reservations_dates_idx on hotel_reservations (arrival, departure);
create index hotel_reservations_client_idx on hotel_reservations (client_id);

create table hotel_reservation_extras (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references hotel_reservations(id) on delete cascade,
  service_id uuid references hotel_services(id) on delete set null,
  label text not null,
  unit_price integer not null check (unit_price >= 0),
  quantity integer not null default 1 check (quantity >= 1),
  multiplier integer not null default 1 check (multiplier >= 1)
);
create index hotel_extras_res_idx on hotel_reservation_extras (reservation_id);

create table hotel_payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references hotel_reservations(id) on delete cascade,
  amount integer not null check (amount <> 0),
  method text not null check (method in ('cash', 'mvola', 'orange_money', 'airtel_money', 'cheque', 'transfer', 'other')),
  kind text not null default 'payment' check (kind in ('deposit', 'payment', 'refund')),
  paid_on date not null,
  note text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index hotel_payments_res_idx on hotel_payments (reservation_id);
create index hotel_payments_date_idx on hotel_payments (paid_on);

-- RLS (voir 002) : activé sans policy sur toutes les nouvelles tables
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
