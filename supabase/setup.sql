-- PITS CLUB : installation en un seul passage (Supabase > SQL Editor > New query > coller > Run).
-- 1) Remplace REMPLACER-PAR-UN-SECRET-LONG tout en bas par une phrase secrète à toi (garde-la : elle servira dans le Sheet).
-- 2) Lance. Les courses arrivent ensuite via l'Apps Script (installTriggers envoie tout l'historique).

-- MK Companion : schéma initial (lots 1 à 3).
-- À coller dans Supabase > SQL Editor, puis lancer seed.sql.
-- Les courses sont stockées brutes, telles que saisies dans le Form ; le nettoyage
-- (doublons < 60 s, noms en double) est fait par l'app, avec le même code partout.

create extension if not exists pgcrypto;

-- Joueurs ------------------------------------------------------------------
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,              -- exactement comme dans le Form
  display_name text,
  color text not null default '#9AA3B5',
  active boolean not null default true,
  confirmed boolean not null default true, -- false = nom découvert automatiquement
  user_id uuid unique references auth.users(id) on delete set null,
  slack_user_id text unique,
  created_at timestamptz not null default now()
);

-- Courses (brutes) ---------------------------------------------------------
create table if not exists races (
  id bigint generated always as identity primary key,
  ts timestamp not null unique,           -- heure de Paris, telle que dans le Sheet
  p1 text not null, p2 text not null, p3 text not null, p4 text not null,
  source text not null default 'form' check (source in ('form', 'archive', 'app')),
  inserted_at timestamptz not null default now()
);
create index if not exists races_ts_idx on races (ts);

-- Sessions : seulement les clôtures manuelles (le reste est calculé) -------------
create table if not exists session_closures (
  day date primary key,
  closed_at timestamptz not null default now(),
  closed_by uuid references players(id)
);

-- Présence du matin (bot Slack ou app) --------------------------------------
create table if not exists presence (
  day date not null,
  player_id uuid not null references players(id) on delete cascade,
  answer text not null check (answer in ('yes', 'no', 'maybe')),
  updated_at timestamptz not null default now(),
  primary key (day, player_id)
);

-- Takes (lot 2) -------------------------------------------------------------
create table if not exists takes (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  author_id uuid not null references players(id) on delete cascade,
  raw_text text not null,
  rule jsonb,                       -- règle structurée validée par l'auteur
  rule_label text,                  -- reformulation lisible
  probability numeric,              -- estimée au moment de la saisie
  points_if_won int,
  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'void')),
  revealed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day, author_id)
);

-- Contenus générés (lot 3) ------------------------------------------------------
create table if not exists horoscopes (
  day date not null,
  player_id uuid not null references players(id) on delete cascade,
  body text not null,
  signals jsonb,
  verdict text check (verdict in ('right', 'wrong')),
  primary key (day, player_id)
);

create table if not exists journal (
  day date primary key,
  body text not null,
  highlights jsonb,
  created_at timestamptz not null default now()
);

create table if not exists player_badges (
  id bigint generated always as identity primary key,
  player_id uuid not null references players(id) on delete cascade,
  badge text not null,
  day date not null,
  race_ts timestamp,
  unique (player_id, badge, day)
);

create table if not exists seasons (
  month date primary key,              -- 1er jour du mois
  standings jsonb not null,
  titles jsonb not null,
  closed_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);
insert into settings (key, value) values
  ('race_minutes', '2.77'),
  ('min_races_day_record', '5'),
  ('min_shared_races_h2h', '10'),
  ('hide_opponent_after_days', '60'),
  ('session_idle_minutes', '20'),
  ('takes_deadline', '"13:00"'),
  ('elo_k', '12')
on conflict (key) do nothing;

-- Secret partagé avec l'Apps Script (jamais lisible par l'app) ---------------
create table if not exists app_secrets (
  key text primary key,
  value text not null
);

-- Synchro depuis le Google Sheet -------------------------------------------------
-- Ajoute une course (appelé à chaque réponse du Form). Crée les joueurs inconnus.
create or replace function add_race(secret text, race_ts timestamp, n1 text, n2 text, n3 text, n4 text, src text default 'form')
returns void language plpgsql security definer set search_path = public as $$
begin
  if secret is distinct from (select value from app_secrets where key = 'sheet_sync') then
    raise exception 'secret invalide';
  end if;
  insert into players (name, confirmed)
    select distinct trim(n), false from unnest(array[n1, n2, n3, n4]) as n
    where trim(n) <> '' on conflict (name) do nothing;
  insert into races (ts, p1, p2, p3, p4, source)
    values (race_ts, trim(n1), trim(n2), trim(n3), trim(n4), src)
    on conflict (ts) do update set p1 = excluded.p1, p2 = excluded.p2, p3 = excluded.p3, p4 = excluded.p4;
end $$;

-- Réconciliation complète (appelée chaque nuit) : le Sheet fait foi.
-- rows = [{"ts":"2026-10-14 13:31:08","p":["A","B","C","D"],"src":"form"}, ...]
create or replace function sync_races(secret text, rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inserted int; deleted int;
begin
  if secret is distinct from (select value from app_secrets where key = 'sheet_sync') then
    raise exception 'secret invalide';
  end if;
  create temp table incoming on commit drop as
    select (r->>'ts')::timestamp as ts,
           trim(r->'p'->>0) p1, trim(r->'p'->>1) p2, trim(r->'p'->>2) p3, trim(r->'p'->>3) p4,
           coalesce(r->>'src', 'form') src
    from jsonb_array_elements(rows) r;
  insert into players (name, confirmed)
    select distinct n, false from incoming, unnest(array[p1, p2, p3, p4]) n
    where n <> '' on conflict (name) do nothing;
  insert into races (ts, p1, p2, p3, p4, source)
    select ts, p1, p2, p3, p4, src from incoming
    on conflict (ts) do update set p1 = excluded.p1, p2 = excluded.p2, p3 = excluded.p3, p4 = excluded.p4;
  get diagnostics inserted = row_count;
  delete from races r where r.source <> 'app' and not exists (select 1 from incoming i where i.ts = r.ts);
  get diagnostics deleted = row_count;
  return jsonb_build_object('upserted', inserted, 'deleted', deleted);
end $$;

-- Lier son compte à son nom de joueur (une seule fois, nom pas encore pris)
create or replace function claim_player(player_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if exists (select 1 from players where user_id = auth.uid()) then
    raise exception 'ce compte est déjà lié à un joueur';
  end if;
  update players set user_id = auth.uid() where name = player_name and user_id is null;
  if not found then raise exception 'joueur introuvable ou déjà pris'; end if;
end $$;
revoke execute on function claim_player(text) from anon, public;
grant execute on function claim_player(text) to authenticated;

create or replace function current_player_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from players where user_id = auth.uid()
$$;

-- Row Level Security ----------------------------------------------------------------
alter table players enable row level security;
alter table races enable row level security;
alter table session_closures enable row level security;
alter table presence enable row level security;
alter table takes enable row level security;
alter table horoscopes enable row level security;
alter table journal enable row level security;
alter table player_badges enable row level security;
alter table seasons enable row level security;
alter table settings enable row level security;
alter table app_secrets enable row level security; -- aucune policy : illisible

-- Lecture publique des stats (la consultation ne demande pas de compte)
create policy "read players" on players for select using (true);
create policy "read races" on races for select using (true);
create policy "read closures" on session_closures for select using (true);
create policy "read presence" on presence for select using (true);
create policy "read horoscopes" on horoscopes for select using (true);
create policy "read journal" on journal for select using (true);
create policy "read badges" on player_badges for select using (true);
create policy "read seasons" on seasons for select using (true);
create policy "read settings" on settings for select using (true);

-- Un joueur connecté peut modifier son profil d'affichage
create policy "edit own player" on players for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Clôture manuelle d'une session : n'importe quel joueur connecté
create policy "close session" on session_closures for insert
  with check (current_player_id() is not null);
create policy "reopen session" on session_closures for delete
  using (current_player_id() is not null);

-- Présence : chacun la sienne
create policy "own presence" on presence for all
  using (player_id = current_player_id()) with check (player_id = current_player_id());

-- Takes : son propre Take toujours ; ceux des autres seulement après révélation
create policy "read takes" on takes for select
  using (revealed or author_id = current_player_id());
create policy "write own take" on takes for insert
  with check (author_id = current_player_id() and status = 'pending' and not revealed);
create policy "edit own take before deadline" on takes for update
  using (author_id = current_player_id() and not revealed
         and (now() at time zone 'Europe/Paris') < (day + time '13:00'))
  with check (author_id = current_player_id() and status = 'pending' and not revealed);

-- Qui a posté un Take ce jour-là (sans le contenu)
create or replace function takes_posted(on_day date)
returns table (author_id uuid) language sql stable security definer set search_path = public as $$
  select author_id from takes where day = on_day
$$;

-- Pilotes et couleurs (repris de l'onglet Réglages)
insert into players (name, active, color) values
  ('Charlie', true, '#E60012'),
  ('Camille', true, '#FF5FA2'),
  ('Romaing', true, '#3A7BFF'),
  ('Roro', true, '#F59E0B'),
  ('Bap2', true, '#22A06B'),
  ('Louane', true, '#8B5CF6'),
  ('Paul', true, '#0E9AA7'),
  ('Ayann', true, '#8D6E63'),
  ('Auguste', true, '#546E7A'),
  ('Maxence', false, '#7CB342'),
  ('Eva', false, '#D81B60'),
  ('Genevieve', false, '#FF7043'),
  ('Baptiste', false, '#26A6C2'),
  ('Other', false, '#9E9E9E')
on conflict (name) do update set active = excluded.active, color = excluded.color;

-- Pits Club : choix du pilote avec pseudo, pseudo modifiable.
-- Les joueurs ne modifient plus leur ligne directement : tout passe par des fonctions contrôlées.

drop policy if exists "edit own player" on players;

drop function if exists claim_player(text);
create or replace function claim_player(player_name text, nickname text default null)
returns void language plpgsql security definer set search_path = public as $$
declare nick text := nullif(trim(nickname), '');
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord.'; end if;
  if exists (select 1 from players where user_id = auth.uid()) then
    raise exception 'Ce compte est déjà lié à un pilote.';
  end if;
  if nick is not null and (length(nick) < 2 or length(nick) > 20) then
    raise exception 'Le pseudo doit faire entre 2 et 20 caractères.';
  end if;
  if nick is not null and exists (
    select 1 from players where name <> player_name and (lower(name) = lower(nick) or lower(display_name) = lower(nick))
  ) then raise exception 'Ce pseudo est déjà pris.'; end if;
  update players set user_id = auth.uid(), display_name = nick
    where name = player_name and user_id is null and name <> 'Other';
  if not found then raise exception 'Ce pilote est introuvable ou déjà pris.'; end if;
end $$;
revoke execute on function claim_player(text, text) from anon, public;
grant execute on function claim_player(text, text) to authenticated;

create or replace function set_display_name(nickname text)
returns void language plpgsql security definer set search_path = public as $$
declare nick text := nullif(trim(nickname), ''); me uuid := current_player_id();
begin
  if me is null then raise exception 'Aucun pilote lié à ce compte.'; end if;
  if nick is not null and (length(nick) < 2 or length(nick) > 20) then
    raise exception 'Le pseudo doit faire entre 2 et 20 caractères.';
  end if;
  if nick is not null and exists (
    select 1 from players where id <> me and (lower(name) = lower(nick) or lower(display_name) = lower(nick))
  ) then raise exception 'Ce pseudo est déjà pris.'; end if;
  update players set display_name = nick where id = me;
end $$;
revoke execute on function set_display_name(text) from anon, public;
grant execute on function set_display_name(text) to authenticated;

-- Pits Club : les données ne sont lisibles que par les membres connectés (pilotes ou visiteurs).
-- La synchro du Google Sheet n'est pas concernée : elle passe par add_race / sync_races, protégées par le secret.
drop policy if exists "read players" on players;
drop policy if exists "read races" on races;
drop policy if exists "read closures" on session_closures;
drop policy if exists "read presence" on presence;
drop policy if exists "read horoscopes" on horoscopes;
drop policy if exists "read journal" on journal;
drop policy if exists "read badges" on player_badges;
drop policy if exists "read seasons" on seasons;
drop policy if exists "read settings" on settings;

create policy "read players" on players for select to authenticated using (true);
create policy "read races" on races for select to authenticated using (true);
create policy "read closures" on session_closures for select to authenticated using (true);
create policy "read presence" on presence for select to authenticated using (true);
create policy "read horoscopes" on horoscopes for select to authenticated using (true);
create policy "read journal" on journal for select to authenticated using (true);
create policy "read badges" on player_badges for select to authenticated using (true);
create policy "read seasons" on seasons for select to authenticated using (true);
create policy "read settings" on settings for select to authenticated using (true);

revoke execute on function takes_posted(date) from anon, public;
grant execute on function takes_posted(date) to authenticated;

-- Pits Club : photos des pilotes (bucket privé, lisible par les membres connectés).
alter table players add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Lecture : tout membre connecté. Écriture : chacun dans son propre dossier players/<id de son pilote>/.
drop policy if exists "avatars read" on storage.objects;
drop policy if exists "avatars write own" on storage.objects;
drop policy if exists "avatars update own" on storage.objects;
drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
create policy "avatars write own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'players'
              and (storage.foldername(name))[2] = current_player_id()::text);
create policy "avatars update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'players'
         and (storage.foldername(name))[2] = current_player_id()::text);
create policy "avatars delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'players'
         and (storage.foldername(name))[2] = current_player_id()::text);

-- Enregistrer (ou retirer avec null) sa photo : uniquement un fichier de son propre dossier.
create or replace function set_avatar(path text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := current_player_id();
begin
  if me is null then raise exception 'Aucun pilote lié à ce compte.'; end if;
  if path is not null and path not like 'players/' || me::text || '/%' then
    raise exception 'Chemin de photo invalide.';
  end if;
  update players set avatar_path = path where id = me;
end $$;
revoke execute on function set_avatar(text) from anon, public;
grant execute on function set_avatar(text) to authenticated;

-- Secret partagé avec l'Apps Script du Sheet
insert into app_secrets (key, value) values ('sheet_sync', 'REMPLACER-PAR-UN-SECRET-LONG')
on conflict (key) do update set value = excluded.value;


-- ======================================================== 005_live_roster.sql
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


-- ======================================================== 006_bot_takes_admin.sql
-- 006 : back-office admin, réglages du bot Slack, Takes réels, planificateur.
-- À exécuter une fois dans Supabase > SQL Editor (source : Database).
-- Le dernier résultat affiché est le « secret du bot » à recopier dans Vercel (variable BOT_SECRET).

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1) Administrateurs ----------------------------------------------------------
create table if not exists app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table app_admins enable row level security;
drop policy if exists "read admins" on app_admins;
create policy "read admins" on app_admins for select to authenticated using (true);

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid())
$$;

-- Romain (pilote « Romaing ») est le premier admin.
insert into app_admins (user_id) select user_id from players where name = 'Romaing' and user_id is not null
on conflict do nothing;

-- 2) Réglages ------------------------------------------------------------------
insert into settings (key, value) values
  ('bot_paused', 'false'),              -- coupe tous les envois Slack
  ('bot_pause_reason', '""'),
  ('bot_tone', '"taquin"'),             -- sobre | taquin | piquant
  ('bot_days', '[1,2,3,4,5]'),          -- jours ISO (1 = lundi)
  ('debrief_enabled', 'true'),
  ('debrief_delay_min', '7'),           -- minutes après la dernière course
  ('debrief_takes', 'true'),
  ('reminder_enabled', 'true'),
  ('reminder_time', '"12:00"'),
  ('ai_pen', 'false'),                  -- plume IA pour le débrief (sinon bibliothèque)
  ('takes_enabled', 'true'),
  ('roast_optout', '[]'),               -- pilotes jamais chambrés nommément
  ('app_url', '"https://pits-club.vercel.app"'),
  ('bot_url', '"https://pits-club.vercel.app/api/bot"')
on conflict (key) do nothing;

create or replace function admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  insert into settings (key, value) values (p_key, p_value)
    on conflict (key) do update set value = excluded.value;
end $$;

create or replace function admin_set_admin(p_player text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  select user_id into uid from players where name = p_player;
  if uid is null then raise exception 'Ce pilote n''a pas encore de compte'; end if;
  if p_on then
    insert into app_admins (user_id) values (uid) on conflict do nothing;
  else
    if (select count(*) from app_admins) <= 1 then raise exception 'Il faut garder au moins un admin'; end if;
    delete from app_admins where user_id = uid;
  end if;
end $$;

-- 3) Journal des messages du bot -------------------------------------------------
create table if not exists bot_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('debrief', 'extra', 'reminder', 'test')),
  day date not null,
  upto_ts timestamp,                    -- dernière course couverte par le message
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  body text,
  meta jsonb,                           -- phrases utilisées (anti-répétition), plume, etc.
  error text,
  manual boolean not null default false,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists bot_log_day on bot_log (day, kind);
alter table bot_log enable row level security;
drop policy if exists "admins read bot log" on bot_log;
create policy "admins read bot log" on bot_log for select to authenticated using (is_admin());

create table if not exists bot_state (id int primary key default 1 check (id = 1), last_tick timestamptz);
insert into bot_state (id) values (1) on conflict do nothing;
alter table bot_state enable row level security;
drop policy if exists "admins read bot state" on bot_state;
create policy "admins read bot state" on bot_state for select to authenticated using (is_admin());

-- Secret partagé entre la base et la fonction Vercel (jamais lisible par l'app).
insert into app_secrets (key, value)
  values ('bot', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Appel de la fonction Vercel qui rédige et poste le message.
create or replace function bot_call(p_log bigint)
returns void language plpgsql security definer set search_path = public as $$
declare secret text; url text;
begin
  select value into secret from app_secrets where key = 'bot';
  select value #>> '{}' into url from settings where key = 'bot_url';
  if secret is null or url is null then
    update bot_log set status = 'failed', error = 'Configuration incomplète (secret ou URL)' where id = p_log;
    return;
  end if;
  perform net.http_post(
    url := url,
    body := jsonb_build_object('log_id', p_log),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bot-secret', secret),
    timeout_milliseconds := 20000
  );
end $$;

-- Tourne chaque minute : rappel des Takes, puis débrief 7 min après la dernière course.
create or replace function bot_tick()
returns void language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := now() at time zone 'Europe/Paris';
  today date := (now() at time zone 'Europe/Paris')::date;
  s jsonb;
  paused boolean;
  last_race timestamp;
  lid bigint;
  rtime time;
begin
  update bot_state set last_tick = now() where id = 1;
  select jsonb_object_agg(key, value) into s from settings;
  if not coalesce(s->'bot_days', '[1,2,3,4,5]'::jsonb) @> to_jsonb(extract(isodow from loc)::int) then return; end if;
  paused := coalesce((s->>'bot_paused')::boolean, false);

  -- Rappel des Takes (une fois, dans les 45 min qui suivent l'heure réglée, avant la clôture)
  rtime := coalesce(s->>'reminder_time', '12:00')::time;
  if coalesce((s->>'reminder_enabled')::boolean, true) and coalesce((s->>'takes_enabled')::boolean, true)
     and loc::time >= rtime and loc::time < rtime + interval '45 minutes'
     and loc::time < coalesce(s->>'takes_deadline', '13:00')::time
     and not exists (select 1 from bot_log where day = today and kind = 'reminder' and not manual) then
    insert into bot_log (kind, day, status) values ('reminder', today, case when paused then 'skipped' else 'pending' end)
      returning id into lid;
    if not paused then perform bot_call(lid); end if;
  end if;

  -- Débrief : X minutes sans nouvelle course (ou session clôturée dans l'app)
  select max(ts) into last_race from races where ts::date = today;
  if last_race is null then return; end if;
  if loc - last_race < make_interval(mins => coalesce((s->>'debrief_delay_min')::int, 7))
     and not exists (select 1 from session_closures where day = today) then return; end if;

  -- Les Takes du jour sont révélés, que Slack soit actif ou non.
  update takes set revealed = true, updated_at = now() where day = today and not revealed;

  if not coalesce((s->>'debrief_enabled')::boolean, true) then return; end if;
  if not exists (select 1 from bot_log where day = today and kind = 'debrief' and not manual) then
    insert into bot_log (kind, day, upto_ts, status) values ('debrief', today, last_race, case when paused then 'skipped' else 'pending' end)
      returning id into lid;
  elsif not exists (select 1 from bot_log where day = today and kind in ('debrief', 'extra') and upto_ts >= last_race)
        and (select count(*) from bot_log where day = today and kind = 'extra') < 3 then
    -- des courses ont été jouées après le débrief : « prolongations »
    insert into bot_log (kind, day, upto_ts, status) values ('extra', today, last_race, case when paused then 'skipped' else 'pending' end)
      returning id into lid;
  else
    return;
  end if;
  if not paused then perform bot_call(lid); end if;
end $$;

-- Données pour la fonction Vercel (protégé par le secret du bot).
create or replace function bot_payload(secret text, p_log bigint default null, p_day date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare lg bot_log; d date;
begin
  if secret is distinct from (select value from app_secrets where key = 'bot') then raise exception 'secret invalide'; end if;
  if p_log is not null then select * into lg from bot_log where id = p_log; end if;
  d := coalesce(lg.day, p_day, (now() at time zone 'Europe/Paris')::date);
  return jsonb_build_object(
    'log', to_jsonb(lg),
    'day', d,
    'settings', (select jsonb_object_agg(key, value) from settings),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'display_name', display_name, 'color', color, 'active', active)), '[]') from players),
    'races', (select coalesce(jsonb_agg(jsonb_build_array(to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS'), p1, p2, p3, p4, source) order by ts), '[]') from races),
    'closures', (select coalesce(jsonb_agg(day), '[]') from session_closures),
    'takes', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', t.id, 'author', p.name, 'text', t.raw_text, 'rule', t.rule, 'label', t.rule_label,
                'probability', t.probability, 'points', t.points_if_won, 'status', t.status, 'revealed', t.revealed)), '[]')
              from takes t join players p on p.id = t.author_id where t.day = d),
    'recent_meta', (select coalesce(jsonb_agg(meta), '[]') from (select meta from bot_log where meta is not null order by id desc limit 20) m)
  );
end $$;

create or replace function bot_result(secret text, p_log bigint, p_status text, p_body text, p_error text default null, p_meta jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if secret is distinct from (select value from app_secrets where key = 'bot') then raise exception 'secret invalide'; end if;
  update bot_log set status = p_status, body = p_body, error = p_error, meta = coalesce(p_meta, meta),
    sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_log;
end $$;

-- Envoi manuel depuis le back-office (la fonction Vercel vérifie d'abord que l'appelant est admin).
create or replace function bot_queue(secret text, p_kind text, p_day date)
returns bigint language plpgsql security definer set search_path = public as $$
declare lid bigint; last_race timestamp;
begin
  if secret is distinct from (select value from app_secrets where key = 'bot') then raise exception 'secret invalide'; end if;
  select max(ts) into last_race from races where ts::date = p_day;
  insert into bot_log (kind, day, upto_ts, status, manual) values (p_kind, p_day, last_race, 'pending', true) returning id into lid;
  return lid;
end $$;

-- 4) Takes réels ------------------------------------------------------------------
create or replace function submit_take(p_text text, p_rule jsonb, p_label text, p_probability numeric, p_points int)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_player_id();
  loc timestamp := now() at time zone 'Europe/Paris';
  deadline time := coalesce((select value #>> '{}' from settings where key = 'takes_deadline'), '13:00')::time;
begin
  if me is null then raise exception 'Seuls les pilotes peuvent poster un Take'; end if;
  if not coalesce((select (value #>> '{}')::boolean from settings where key = 'takes_enabled'), true) then
    raise exception 'Les Takes sont désactivés pour le moment';
  end if;
  if loc::time >= deadline then raise exception 'Trop tard : les Takes ferment à %', to_char(deadline, 'HH24"h"MI'); end if;
  if exists (select 1 from races where ts::date = loc::date) then raise exception 'Trop tard : la session a déjà commencé'; end if;
  if length(trim(coalesce(p_text, ''))) < 3 then raise exception 'Ton Take est vide'; end if;
  insert into takes (day, author_id, raw_text, rule, rule_label, probability, points_if_won)
    values (loc::date, me, left(trim(p_text), 280), p_rule, p_label, p_probability, p_points)
  on conflict (day, author_id) do update set raw_text = excluded.raw_text, rule = excluded.rule, rule_label = excluded.rule_label,
    probability = excluded.probability, points_if_won = excluded.points_if_won, status = 'pending', updated_at = now()
    where not takes.revealed;
end $$;

create or replace function delete_my_take()
returns void language plpgsql security definer set search_path = public as $$
declare loc timestamp := now() at time zone 'Europe/Paris';
begin
  delete from takes where author_id = current_player_id() and day = loc::date and not revealed
    and loc::time < coalesce((select value #>> '{}' from settings where key = 'takes_deadline'), '13:00')::time;
end $$;

-- pending = verdict automatique ; won / lost / void = verdict forcé par un admin
create or replace function admin_set_take_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  if p_status not in ('pending', 'won', 'lost', 'void') then raise exception 'Statut inconnu'; end if;
  update takes set status = p_status, updated_at = now() where id = p_id and revealed;
end $$;

create or replace function admin_reveal_takes(p_day date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  update takes set revealed = true, updated_at = now() where day = p_day;
end $$;

-- Qui a posté (noms seulement, jamais le contenu avant la révélation)
create or replace function takes_posted_names(on_day date)
returns table (name text) language sql stable security definer set search_path = public as $$
  select p.name from takes t join players p on p.id = t.author_id where t.day = on_day
$$;

-- 5) Droits ------------------------------------------------------------------------
revoke all on function bot_tick() from public, anon, authenticated;
revoke all on function bot_call(bigint) from public, anon, authenticated;
revoke all on function admin_set_setting(text, jsonb) from public, anon;
revoke all on function admin_set_admin(text, boolean) from public, anon;
revoke all on function admin_set_take_status(uuid, text) from public, anon;
revoke all on function admin_reveal_takes(date) from public, anon;
revoke all on function submit_take(text, jsonb, text, numeric, int) from public, anon;
revoke all on function delete_my_take() from public, anon;
revoke all on function takes_posted_names(date) from public, anon;
grant execute on function admin_set_setting(text, jsonb), admin_set_admin(text, boolean), admin_set_take_status(uuid, text),
  admin_reveal_takes(date), submit_take(text, jsonb, text, numeric, int), delete_my_take(), takes_posted_names(date), is_admin()
  to authenticated;
-- appelées par la fonction Vercel avec la clé publique, protégées par le secret du bot
grant execute on function bot_payload(text, bigint, date), bot_result(text, bigint, text, text, text, jsonb), bot_queue(text, text, date) to anon, authenticated;

-- 6) Planificateur : chaque minute -------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'pits-bot';
select cron.schedule('pits-bot', '* * * * *', 'select public.bot_tick()');

-- Secret à recopier dans Vercel (Settings > Environment Variables > BOT_SECRET)
select value as "BOT_SECRET (à copier dans Vercel)" from app_secrets where key = 'bot';


-- ======================================================== 007_bans.sql
-- 007 : gestion des membres par les admins (bannir, réactiver, délier un pilote, nommer admin).
-- À exécuter une fois dans Supabase > SQL Editor (source : Database).
-- Un membre banni ne voit plus aucune donnée et ne peut plus rien modifier.
-- Ses courses restent dans les stats : ce sont des résultats du formulaire, pas des données de son compte.

create table if not exists banned_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text,
  banned_by uuid references auth.users(id) on delete set null,
  banned_at timestamptz not null default now()
);
alter table banned_users enable row level security;   -- aucune policy : lecture via les fonctions admin uniquement

create or replace function is_banned()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from banned_users where user_id = auth.uid())
$$;
grant execute on function is_banned() to authenticated;

-- Un compte banni n'est plus « le pilote » ni admin : toutes les fonctions qui s'appuient dessus le refusent.
create or replace function current_player_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from players where user_id = auth.uid() and not exists (select 1 from banned_users where user_id = auth.uid())
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid())
     and not exists (select 1 from banned_users where user_id = auth.uid())
$$;

-- Verrou général : une policy restrictive s'ajoute à toutes les autres sur chaque table lue par l'app.
do $$
declare t text;
begin
  foreach t in array array['players', 'races', 'session_closures', 'presence', 'takes', 'horoscopes', 'journal',
                           'player_badges', 'seasons', 'settings', 'bot_log', 'bot_state', 'app_admins'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "not banned" on %I', t);
      execute format('create policy "not banned" on %I as restrictive for all to authenticated using (not is_banned()) with check (not is_banned())', t);
    end if;
  end loop;
end $$;

drop policy if exists "avatars not banned" on storage.objects;
create policy "avatars not banned" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'avatars' or not public.is_banned())
  with check (bucket_id <> 'avatars' or not public.is_banned());

-- Choix du pilote : refusé à un compte banni.
create or replace function claim_player(player_name text, nickname text default null)
returns void language plpgsql security definer set search_path = public as $$
declare nick text := nullif(trim(nickname), '');
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord.'; end if;
  if is_banned() then raise exception 'Accès retiré par un admin.'; end if;
  if exists (select 1 from players where user_id = auth.uid()) then
    raise exception 'Ce compte est déjà lié à un pilote.';
  end if;
  if nick is not null and (length(nick) < 2 or length(nick) > 20) then
    raise exception 'Le pseudo doit faire entre 2 et 20 caractères.';
  end if;
  if nick is not null and exists (
    select 1 from players where name <> player_name and (lower(name) = lower(nick) or lower(display_name) = lower(nick))
  ) then raise exception 'Ce pseudo est déjà pris.'; end if;
  update players set user_id = auth.uid(), display_name = nick
    where name = player_name and user_id is null and name <> 'Other';
  if not found then raise exception 'Ce pilote est introuvable ou déjà pris.'; end if;
end $$;

create or replace function takes_posted_names(on_day date)
returns table (name text) language sql stable security definer set search_path = public as $$
  select p.name from takes t join players p on p.id = t.author_id where t.day = on_day and not is_banned()
$$;

-- Liste des membres pour le back-office
create or replace function admin_members()
returns table (user_id uuid, email text, player text, display_name text, visitor boolean, admin boolean,
               banned boolean, ban_reason text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  return query
    select u.id, u.email::text, p.name, p.display_name,
           p.name is null and coalesce(u.raw_user_meta_data->>'role', '') = 'visitor',
           exists (select 1 from app_admins a where a.user_id = u.id),
           b.user_id is not null, b.reason, u.created_at, u.last_sign_in_at
    from auth.users u
    left join players p on p.user_id = u.id
    left join banned_users b on b.user_id = u.id
    order by (b.user_id is not null), u.created_at;
end $$;

create or replace function admin_ban(p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  if p_user = auth.uid() then raise exception 'Tu ne peux pas te bannir toi-même.'; end if;
  if exists (select 1 from app_admins where user_id = p_user) then raise exception 'Retire d''abord son rôle d''admin.'; end if;
  insert into banned_users (user_id, reason, banned_by) values (p_user, nullif(trim(p_reason), ''), auth.uid())
    on conflict (user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by, banned_at = now();
end $$;

create or replace function admin_unban(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  delete from banned_users where user_id = p_user;
end $$;

-- Délier un compte de son pilote (mauvais choix à l'inscription) : le pilote redevient libre.
create or replace function admin_unlink(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  update players set user_id = null, display_name = null where user_id = p_user;
end $$;

create or replace function admin_set_role(p_user uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  if p_admin then
    if exists (select 1 from banned_users where user_id = p_user) then raise exception 'Réactive d''abord ce membre.'; end if;
    insert into app_admins (user_id) values (p_user) on conflict do nothing;
  else
    if p_user = auth.uid() then raise exception 'Tu ne peux pas te retirer toi-même le rôle d''admin.'; end if;
    delete from app_admins where user_id = p_user;
  end if;
end $$;

revoke all on function admin_members(), admin_ban(uuid, text), admin_unban(uuid), admin_unlink(uuid), admin_set_role(uuid, boolean) from public, anon;
grant execute on function admin_members(), admin_ban(uuid, text), admin_unban(uuid), admin_unlink(uuid), admin_set_role(uuid, boolean) to authenticated;


-- ======================================================== 008_hidden_players.sql
-- 008 : effacer des pilotes de l'app (sans toucher aux courses, qui restent justes pour les autres).
-- À exécuter une fois dans Supabase > SQL Editor (source : Database).

alter table players add column if not exists hidden boolean not null default false;

update players set hidden = true, active = false where name in ('Genevieve', 'Baptiste', 'Auguste', 'Eva');

-- Un pilote effacé ne revient pas tout seul, même s'il réapparaît dans le formulaire.
create or replace function admin_set_hidden(p_player text, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  if p_hidden and exists (select 1 from players where name = p_player and user_id is not null) then
    raise exception 'Ce pilote est lié à un compte : délie-le d''abord dans « Membres ».';
  end if;
  update players set hidden = p_hidden, active = case when p_hidden then false else active end where name = p_player;
  if not found then raise exception 'Pilote introuvable'; end if;
end $$;
revoke all on function admin_set_hidden(text, boolean) from public, anon;
grant execute on function admin_set_hidden(text, boolean) to authenticated;

-- Un pilote effacé n'est pas réactivé par une nouvelle course (seul un admin peut le restaurer).
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
    where name = any (select trim(x) from unnest(names) x) and not active and not hidden and name <> 'Other';
end $$;
revoke all on function touch_players(text[]) from public, anon, authenticated;
