-- 005 : direct (Realtime) + gestion automatique des pilotes actifs / anciens.
-- À exécuter une fois dans Supabase > SQL Editor (source : Database).

-- 1) Direct : l'app ouverte est prévenue à chaque nouvelle course.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'races') then
    alter publication supabase_realtime add table races;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'session_closures') then
    alter publication supabase_realtime add table session_closures;
  end if;
end $$;

-- 2) Pilotes vus dans une course récente : créés s'ils sont nouveaux (avec une couleur libre),
--    et réactivés s'ils étaient passés en « anciens ».
create or replace function touch_players(names text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  n text;
  palette text[] := array['#00BCD4','#FFB300','#AB47BC','#43A047','#F4511E','#5C6BC0','#EC407A','#26A69A','#C0CA33','#78909C'];
  c text;
begin
  foreach n in array names loop
    n := trim(n);
    continue when n is null or n = '';
    if not exists (select 1 from players where name = n) then
      select p into c from unnest(palette) p where p not in (select color from players) limit 1;
      insert into players (name, confirmed, active, color)
        values (n, false, true, coalesce(c, palette[1 + abs(hashtext(n)) % array_length(palette, 1)]))
        on conflict (name) do nothing;
    end if;
  end loop;
  update players set active = true
    where name = any (select trim(x) from unnest(names) x) and not active and name <> 'Other';
end $$;
revoke all on function touch_players(text[]) from public, anon, authenticated;

-- 3) Chaque réponse au formulaire : course enregistrée + pilotes créés ou réactivés.
create or replace function add_race(secret text, race_ts timestamp, n1 text, n2 text, n3 text, n4 text, src text default 'form')
returns void language plpgsql security definer set search_path = public as $$
begin
  if secret is distinct from (select value from app_secrets where key = 'sheet_sync') then
    raise exception 'secret invalide';
  end if;
  perform touch_players(array[n1, n2, n3, n4]);
  insert into races (ts, p1, p2, p3, p4, source)
    values (race_ts, trim(n1), trim(n2), trim(n3), trim(n4), src)
    on conflict (ts) do update set p1 = excluded.p1, p2 = excluded.p2, p3 = excluded.p3, p4 = excluded.p4;
end $$;

-- 4) Réconciliation de nuit : l'historique ne réactive personne ; seules les courses des 3 derniers jours
--    réactivent (filet de sécurité si une réponse au formulaire a été manquée).
create or replace function sync_races(secret text, rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inserted int; deleted int; recent text[];
begin
  if secret is distinct from (select value from app_secrets where key = 'sheet_sync') then
    raise exception 'secret invalide';
  end if;
  create temp table incoming on commit drop as
    select (r->>'ts')::timestamp as ts,
           trim(r->'p'->>0) p1, trim(r->'p'->>1) p2, trim(r->'p'->>2) p3, trim(r->'p'->>3) p4,
           coalesce(r->>'src', 'form') src
    from jsonb_array_elements(rows) r;
  insert into players (name, confirmed, active)
    select distinct n, false, false from incoming, unnest(array[p1, p2, p3, p4]) n
    where n <> '' on conflict (name) do nothing;
  select array_agg(distinct n) into recent from incoming, unnest(array[p1, p2, p3, p4]) n
    where ts > now() - interval '3 days' and n <> '';
  if recent is not null then perform touch_players(recent); end if;
  insert into races (ts, p1, p2, p3, p4, source)
    select ts, p1, p2, p3, p4, src from incoming
    on conflict (ts) do update set p1 = excluded.p1, p2 = excluded.p2, p3 = excluded.p3, p4 = excluded.p4;
  get diagnostics inserted = row_count;
  delete from races r where r.source <> 'app' and not exists (select 1 from incoming i where i.ts = r.ts);
  get diagnostics deleted = row_count;
  return jsonb_build_object('upserted', inserted, 'deleted', deleted);
end $$;

-- 5) Auguste a quitté l'entreprise : il passe en « ancien pilote » (il revient tout seul s'il rejoue).
update players set active = false where name = 'Auguste';
