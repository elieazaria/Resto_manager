-- Les dépenses peuvent concerner le restaurant ou l'hôtel (résultat net de l'hôtel = CA - dépenses de l'hôtel)
alter table expenses add column if not exists scope text not null default 'restaurant' check (scope in ('restaurant', 'hotel'));
create index if not exists expenses_scope_date_idx on expenses (scope, date);
