-- 010 : nouveau cycle des Takes.
--   brouillon → le pilote clique « Valider » → l'IA analyse → « Take validée ».
--   Modifiable jusqu'à l'heure de clôture (réglage takes_deadline), puis verrouillé.
--   À la clôture, l'IA analyse d'elle-même les brouillons jamais validés.
--   L'admin peut à tout moment valider ou refuser un Take ; sa décision l'emporte sur celle de l'IA.
-- À exécuter une fois dans Supabase > SQL Editor (source : Database).

-- 1) Colonnes ---------------------------------------------------------------------
alter table takes add column if not exists validation text not null default 'draft';
alter table takes add column if not exists admin_validation text;
alter table takes add column if not exists validation_note text;
alter table takes add column if not exists validated_at timestamptz;
alter table takes drop constraint if exists takes_validation_check;
alter table takes add constraint takes_validation_check check (validation in ('draft', 'validated', 'refused'));
alter table takes drop constraint if exists takes_admin_validation_check;
alter table takes add constraint takes_admin_validation_check check (admin_validation is null or admin_validation in ('validated', 'refused'));

-- Les Takes déjà postés avant ce script étaient validés par leur auteur.
update takes set validation = 'validated', validated_at = coalesce(validated_at, updated_at) where validation = 'draft' and created_at < now();

-- 2) Droits de lecture / écriture ---------------------------------------------------
-- Toutes les écritures passent par les fonctions ci-dessous (plus d'écriture directe sur la table).
drop policy if exists "write own take" on takes;
drop policy if exists "edit own take before deadline" on takes;
-- L'admin voit tous les Takes, y compris avant la révélation, pour pouvoir les valider ou les refuser.
drop policy if exists "admins read takes" on takes;
create policy "admins read takes" on takes for select to authenticated using (is_admin());

-- 3) Verrou ----------------------------------------------------------------------------
-- Verrouillé à l'heure de clôture, ou dès la première course du jour (sinon on pronostiquerait en voyant les résultats).
create or replace function takes_locked(p_day date default null)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_day, (now() at time zone 'Europe/Paris')::date) < (now() at time zone 'Europe/Paris')::date
      or (now() at time zone 'Europe/Paris')::time >= coalesce((select value #>> '{}' from settings where key = 'takes_deadline'), '13:00')::time
      or exists (select 1 from races where ts::date = coalesce(p_day, (now() at time zone 'Europe/Paris')::date))
$$;

create or replace function _take_guard()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare me uuid := current_player_id();
begin
  if me is null then raise exception 'Seuls les pilotes peuvent poster un Take'; end if;
  if not coalesce((select (value #>> '{}')::boolean from settings where key = 'takes_enabled'), true) then
    raise exception 'Les Takes sont désactivés pour le moment';
  end if;
  if takes_locked() then
    raise exception 'Trop tard : les Takes sont verrouillés depuis %',
      to_char(coalesce((select value #>> '{}' from settings where key = 'takes_deadline'), '13:00')::time, 'HH24"h"MI');
  end if;
  if exists (select 1 from takes where author_id = me and day = (now() at time zone 'Europe/Paris')::date and revealed) then
    raise exception 'Les Takes du jour sont déjà révélés';
  end if;
  return me;
end $$;

-- 4) Côté pilote ---------------------------------------------------------------------------
-- Enregistre (ou remplace) le texte. Toute modification repasse le Take en brouillon : il faut le revalider.
create or replace function save_take_draft(p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := _take_guard(); d date := (now() at time zone 'Europe/Paris')::date; t text := left(trim(coalesce(p_text, '')), 280);
begin
  if length(t) < 3 then raise exception 'Ton Take est vide'; end if;
  insert into takes (day, author_id, raw_text, validation)
    values (d, me, t, 'draft')
  on conflict (day, author_id) do update set
    raw_text = excluded.raw_text, rule = null, rule_label = null, probability = null, points_if_won = null,
    status = 'pending', validation = 'draft', admin_validation = null, validation_note = null, validated_at = null, updated_at = now()
  -- même texte qu'avant : on ne touche à rien (le Take reste validé)
  where takes.raw_text is distinct from excluded.raw_text or takes.validation <> 'validated';
end $$;

-- Validation après analyse IA. p_rule null = « valider quand même », arbitrage manuel par un admin.
create or replace function validate_my_take(p_text text, p_rule jsonb, p_label text, p_probability numeric, p_points int, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := _take_guard(); d date := (now() at time zone 'Europe/Paris')::date; t text := left(trim(coalesce(p_text, '')), 280);
begin
  if length(t) < 3 then raise exception 'Ton Take est vide'; end if;
  insert into takes (day, author_id, raw_text, rule, rule_label, probability, points_if_won, validation, validation_note, validated_at)
    values (d, me, t, p_rule, case when p_rule is null then null else p_label end, case when p_rule is null then null else p_probability end,
            case when p_rule is null then null else p_points end, 'validated', left(p_note, 300), now())
  on conflict (day, author_id) do update set
    raw_text = excluded.raw_text, rule = excluded.rule, rule_label = excluded.rule_label, probability = excluded.probability,
    points_if_won = excluded.points_if_won, status = 'pending', validation = 'validated',
    -- même texte : une décision admin déjà prise reste en place ; nouveau texte : l'admin repart de zéro
    admin_validation = case when takes.raw_text = excluded.raw_text then takes.admin_validation else null end,
    validation_note = excluded.validation_note, validated_at = now(), updated_at = now();
end $$;

-- Ancien point d'entrée (anciens onglets encore ouverts) : équivaut à une validation.
create or replace function submit_take(p_text text, p_rule jsonb, p_label text, p_probability numeric, p_points int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform validate_my_take(p_text, p_rule, p_label, p_probability, p_points, null);
end $$;

create or replace function delete_my_take()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := _take_guard();
begin
  delete from takes where author_id = me and day = (now() at time zone 'Europe/Paris')::date and not revealed;
end $$;

-- 5) Côté admin -----------------------------------------------------------------------------
-- p_decision : 'validated' | 'refused' | null (rendre la main à l'IA). Possible à tout moment, avant ou après la clôture.
create or replace function admin_validate_take(p_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  if p_decision is not null and p_decision not in ('validated', 'refused') then raise exception 'Décision inconnue'; end if;
  update takes set admin_validation = p_decision, updated_at = now() where id = p_id;
  if not found then raise exception 'Take introuvable'; end if;
end $$;

-- 6) Côté IA (fonction Vercel, protégé par le secret du bot) -----------------------------------
-- Résultat de l'analyse automatique d'un brouillon. N'écrase jamais un Take validé entre-temps.
create or replace function bot_take_result(secret text, p_id uuid, p_validation text, p_rule jsonb, p_label text,
                                           p_probability numeric, p_points int, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if secret is distinct from (select value from app_secrets where key = 'bot') then raise exception 'secret invalide'; end if;
  if p_validation not in ('validated', 'refused') then raise exception 'validation inconnue'; end if;
  update takes set validation = p_validation, rule = p_rule, rule_label = p_label, probability = p_probability,
    points_if_won = p_points, validation_note = left(p_note, 300), validated_at = now(), updated_at = now()
  where id = p_id and validation = 'draft';
end $$;

-- Journal : nouveau type « takes » (analyse automatique des brouillons, rien n'est posté sur Slack).
alter table bot_log drop constraint if exists bot_log_kind_check;
alter table bot_log add constraint bot_log_kind_check check (kind in ('debrief', 'extra', 'reminder', 'test', 'takes'));

-- Données pour la fonction Vercel : ajoute la validation des Takes et les surnoms des pilotes.
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
    'players', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'display_name', display_name, 'color', color, 'active', active, 'aliases', aliases)), '[]') from players),
    'races', (select coalesce(jsonb_agg(jsonb_build_array(to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS'), p1, p2, p3, p4, source) order by ts), '[]') from races),
    'closures', (select coalesce(jsonb_agg(day), '[]') from session_closures),
    'takes', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', t.id, 'author', p.name, 'text', t.raw_text, 'rule', t.rule, 'label', t.rule_label,
                'probability', t.probability, 'points', t.points_if_won, 'status', t.status, 'revealed', t.revealed,
                'validation', coalesce(t.admin_validation, t.validation), 'ai_validation', t.validation)), '[]')
              from takes t join players p on p.id = t.author_id where t.day = d),
    'recent_meta', (select coalesce(jsonb_agg(meta), '[]') from (select meta from bot_log where meta is not null order by id desc limit 20) m)
  );
end $$;

-- 7) Planificateur : analyse automatique des brouillons à la clôture --------------------------
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

  -- Clôture : l'IA analyse les brouillons jamais validés (indépendant de Slack et des jours du bot).
  -- Jusqu'à 3 tentatives, espacées de 5 min, si l'IA ne répond pas.
  if takes_locked(today)
     and exists (select 1 from takes where day = today and validation = 'draft' and admin_validation is null and not revealed)
     and (select count(*) from bot_log where day = today and kind = 'takes' and not manual) < 3
     and not exists (select 1 from bot_log where day = today and kind = 'takes' and created_at > now() - interval '5 minutes') then
    insert into bot_log (kind, day, status) values ('takes', today, 'pending') returning id into lid;
    perform bot_call(lid);
  end if;

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
    insert into bot_log (kind, day, upto_ts, status) values ('extra', today, last_race, case when paused then 'skipped' else 'pending' end)
      returning id into lid;
  else
    return;
  end if;
  if not paused then perform bot_call(lid); end if;
end $$;

-- 8) Droits ----------------------------------------------------------------------------------
revoke all on function _take_guard() from public, anon, authenticated;
revoke all on function takes_locked(date) from public, anon;
revoke all on function save_take_draft(text) from public, anon;
revoke all on function validate_my_take(text, jsonb, text, numeric, int, text) from public, anon;
revoke all on function admin_validate_take(uuid, text) from public, anon;
revoke all on function bot_tick() from public, anon, authenticated;
grant execute on function takes_locked(date), save_take_draft(text), validate_my_take(text, jsonb, text, numeric, int, text),
  admin_validate_take(uuid, text) to authenticated;
grant execute on function bot_take_result(text, uuid, text, jsonb, text, numeric, int, text) to anon, authenticated;
