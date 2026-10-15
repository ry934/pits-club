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
