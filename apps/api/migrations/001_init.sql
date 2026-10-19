-- Schema initial de Resto Manager (PostgreSQL / Supabase)
-- Les montants sont en Ariary (entiers, pas de décimales).

-- Creation securisee des types enumeres (evite les erreurs s'ils existent deja)
DO $$ BEGIN
    create type user_role as enum ('manager', 'cashier');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    create type stock_kind as enum ('ingredient', 'product');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    create type menu_kind as enum ('cooked', 'resale');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    create type order_status as enum ('open', 'paid', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    create type payment_method as enum ('cash', 'mvola', 'orange_money', 'airtel_money', 'card');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    create type movement_reason as enum ('purchase', 'sale', 'void', 'adjustment');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Section Utilisateurs
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  full_name text not null,
  role user_role not null,
  password_hash text,
  pin_hash text,
  is_active boolean not null default true,
  token_version integer not null default 0,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  constraint manager_needs_password check (role <> 'manager' or password_hash is not null),
  constraint cashier_needs_secret check (role <> 'cashier' or password_hash is not null or pin_hash is not null)
);
create unique index if not exists app_users_username_key on app_users (lower(username));

-- Section Catalogue
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0
);
create unique index if not exists categories_name_key on categories (lower(name));

create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind stock_kind not null,
  unit text not null default 'unité',
  min_qty numeric(14,3) not null default 0,
  purchase_unit text not null default 'unité',
  purchase_factor numeric(14,4) not null default 1 check (purchase_factor > 0),
  is_active boolean not null default true
);
create unique index if not exists stock_items_name_key on stock_items (lower(name));

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid not null references categories(id),
  kind menu_kind not null default 'cooked',
  price integer not null check (price >= 0),
  stock_item_id uuid references stock_items(id),
  is_active boolean not null default true,
  constraint resale_needs_stock check (kind <> 'resale' or stock_item_id is not null)
);
create unique index if not exists menu_items_name_key on menu_items (lower(name));

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  stock_item_id uuid not null references stock_items(id),
  qty_per_portion numeric(14,3) not null check (qty_per_portion > 0),
  unique (menu_item_id, stock_item_id)
);

-- Section Achats, depenses, stock
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text
);
create unique index if not exists suppliers_name_key on suppliers (lower(name));

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  stock_item_id uuid not null references stock_items(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price integer not null check (unit_price >= 0),
  supplier_id uuid references suppliers(id) on delete set null,
  note text,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);
create index if not exists purchases_date_idx on purchases (date);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  label text not null,
  category text not null default 'Autre',
  amount integer not null check (amount >= 0),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);
create index if not exists expenses_date_idx on expenses (date);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references stock_items(id),
  qty numeric(14,3) not null,
  reason movement_reason not null,
  ref_id uuid,
  note text,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_item_idx on stock_movements (stock_item_id);
create index if not exists stock_movements_ref_idx on stock_movements (ref_id);

-- Section Salle, commandes, ventes
create table if not exists restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);
create unique index if not exists restaurant_tables_name_key on restaurant_tables (lower(name));

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  ticket_no bigint generated by default as identity unique,
  table_id uuid not null references restaurant_tables(id),
  status order_status not null default 'open',
  note text,
  total integer not null default 0,
  payment_method payment_method,
  amount_received integer,
  business_date date,
  opened_by uuid references app_users(id),
  paid_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  void_reason text,
  voided_by uuid references app_users(id),
  voided_at timestamptz
);
create unique index if not exists orders_one_open_per_table on orders (table_id) where status = 'open';
create index if not exists orders_business_date_idx on orders (business_date) where status = 'paid';
create index if not exists orders_status_idx on orders (status);

create table if not exists order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id),
  name text not null,
  unit_price integer not null,
  quantity integer not null check (quantity > 0),
  note text
);
create index if not exists order_lines_order_idx on order_lines (order_id);

-- Section Divers
create table if not exists settings (
  key text primary key,
  value jsonb not null
);

create table if not exists cash_openings (
  date date primary key,
  amount integer not null default 0
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid references app_users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  details jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);