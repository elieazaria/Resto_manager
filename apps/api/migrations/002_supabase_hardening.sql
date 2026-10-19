-- Durcissement pour Supabase.
--
-- Supabase expose automatiquement le schéma `public` via PostgREST (clé anon).
-- Notre front-end ne parle JAMAIS directement à Supabase : seule l'API se connecte
-- (rôle `postgres`, qui contourne RLS). On active donc RLS sur toutes les tables
-- SANS aucune policy => accès refusé pour anon/authenticated.
--
-- ⚠ Toute future migration qui crée une table doit aussi exécuter
--    ALTER TABLE ... ENABLE ROW LEVEL SECURITY;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Ceinture et bretelles : retirer les privilèges des rôles API publics (si présents : Supabase uniquement)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'revoke all on all functions in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'revoke all on all functions in schema public from authenticated';
  end if;
end $$;
