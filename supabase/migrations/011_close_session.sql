-- 011 : la session se clôture à la main, et la clôture déclenche le débrief Slack.
--  * le premier formulaire du jour ouvre la session ;
--  * « Clôturer la session » (n'importe quel pilote connecté) fige les résultats, révèle les Takes
--    et envoie le débrief immédiatement ;
--  * plus aucun débrief automatique « X minutes après la dernière course » ;
--  * une course saisie après la clôture rouvre la session (rien n'est perdu) : la reclôturer envoie
--    un message « prolongations » ;
--  * seul un admin peut rouvrir une session à la main.

-- 1) Clôture / réouverture uniquement par fonctions (plus d'écriture directe dans la table)
drop policy if exists "close session" on session_closures;
drop policy if exists "reopen session" on session_closures;

-- 2) Le tick du bot : débrief uniquement sur clôture
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
  perform pg_advisory_xact_lock(424242);          -- clic « Clôturer » et tick de la minute : jamais deux débriefs
  update bot_state set last_tick = now() where id = 1;
  -- Filet : une session jamais clôturée ne garde pas ses Takes cachés le lendemain.
  update takes set revealed = true, updated_at = now() where day < today and not revealed;

  select jsonb_object_agg(key, value) into s from settings;
  if not coalesce(s->'bot_days', '[1,2,3,4,5]'::jsonb) @> to_jsonb(extract(isodow from loc)::int) then return; end if;
  paused := coalesce((s->>'bot_paused')::boolean, false);

  -- Rappel des Takes (une fois, dans les 45 min qui suivent l'heure réglée, avant la clôture des Takes)
  rtime := coalesce(s->>'reminder_time', '12:00')::time;
  if coalesce((s->>'reminder_enabled')::boolean, true) and coalesce((s->>'takes_enabled')::boolean, true)
     and loc::time >= rtime and loc::time < rtime + interval '45 minutes'
     and loc::time < coalesce(s->>'takes_deadline', '13:00')::time
     and not exists (select 1 from bot_log where day = today and kind = 'reminder' and not manual) then
    insert into bot_log (kind, day, status) values ('reminder', today, case when paused then 'skipped' else 'pending' end)
      returning id into lid;
    if not paused then perform bot_call(lid); end if;
  end if;

  -- Débrief : seulement quand la session du jour est clôturée
  if not exists (select 1 from session_closures where day = today) then return; end if;
  select max(ts) into last_race from races where ts::date = today;
  if last_race is null then return; end if;

  update takes set revealed = true, updated_at = now() where day = today and not revealed;

  if not coalesce((s->>'debrief_enabled')::boolean, true) then return; end if;
  if not exists (select 1 from bot_log where day = today and kind = 'debrief' and not manual) then
    insert into bot_log (kind, day, upto_ts, status) values ('debrief', today, last_race, case when paused then 'skipped' else 'pending' end)
      returning id into lid;
  elsif not exists (select 1 from bot_log where day = today and kind in ('debrief', 'extra') and upto_ts >= last_race)
        and (select count(*) from bot_log where day = today and kind = 'extra') < 3 then
    -- des courses ont été jouées après le premier débrief : « prolongations »
    insert into bot_log (kind, day, upto_ts, status) values ('extra', today, last_race, case when paused then 'skipped' else 'pending' end)
      returning id into lid;
  else
    return;
  end if;
  if not paused then perform bot_call(lid); end if;
end $$;

-- 3) Bouton « Clôturer la session »
create or replace function close_session()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  me uuid := current_player_id();
  s jsonb;
  lg bot_log;
begin
  if me is null then raise exception 'Seuls les pilotes connectés peuvent clôturer la session'; end if;
  if not exists (select 1 from races where ts::date = today) then raise exception 'Aucune course aujourd''hui : rien à clôturer'; end if;
  insert into session_closures (day, closed_by) values (today, me) on conflict (day) do nothing;
  perform bot_tick();

  select jsonb_object_agg(key, value) into s from settings;
  select * into lg from bot_log where day = today and kind in ('debrief', 'extra') order by id desc limit 1;
  return jsonb_build_object(
    'closed', true,
    'debrief', case
      when not coalesce(s->'bot_days', '[1,2,3,4,5]'::jsonb)
           @> to_jsonb(extract(isodow from now() at time zone 'Europe/Paris')::int) then 'off_day'
      when not coalesce((s->>'debrief_enabled')::boolean, true) then 'disabled'
      when lg.id is null then 'none'
      when lg.status = 'skipped' then 'paused'
      else 'sent' end
  );
end $$;
grant execute on function close_session() to authenticated;

create or replace function reopen_session(p_day date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  delete from session_closures where day = p_day;
end $$;
grant execute on function reopen_session(date) to authenticated;

-- 4) Une course saisie après la clôture rouvre la session du jour (une correction de ligne existante, non)
create or replace function add_race(secret text, race_ts timestamp, n1 text, n2 text, n3 text, n4 text, src text default 'form')
returns void language plpgsql security definer set search_path = public as $$
declare is_new boolean;
begin
  if secret is distinct from (select value from app_secrets where key = 'sheet_sync') then
    raise exception 'secret invalide';
  end if;
  perform touch_players(array[n1, n2, n3, n4]);
  is_new := not exists (select 1 from races where ts = race_ts);
  insert into races (ts, p1, p2, p3, p4, source)
    values (race_ts, trim(n1), trim(n2), trim(n3), trim(n4), src)
    on conflict (ts) do update set p1 = excluded.p1, p2 = excluded.p2, p3 = excluded.p3, p4 = excluded.p4;
  if is_new and race_ts::date = (now() at time zone 'Europe/Paris')::date then
    delete from session_closures where day = race_ts::date;
  end if;
end $$;

-- 5) Le réglage de délai n'a plus d'usage
delete from settings where key = 'debrief_delay_min';
