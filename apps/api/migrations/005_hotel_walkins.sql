-- Services vendus sur place à des clients externes (ex. entrée piscine pour des personnes locales)
alter table hotel_services add column if not exists walk_in boolean not null default false;

create table if not exists hotel_walkins (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references hotel_services(id) on delete set null,
  label text not null,
  unit_price integer not null check (unit_price >= 0),
  quantity integer not null default 1 check (quantity >= 1),
  amount integer not null check (amount >= 0),
  method text not null default 'cash',
  sold_on date not null,
  customer text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists hotel_walkins_date_idx on hotel_walkins (sold_on);

insert into hotel_services (name, unit_price, charge_mode, walk_in, sort_order)
select 'Entrée piscine', 20000, 'flat', true, 10
where not exists (select 1 from hotel_services where lower(name) = 'entrée piscine');

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
