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
