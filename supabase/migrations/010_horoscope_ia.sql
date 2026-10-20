-- 010 : horoscope IA du jour (actu + stats, rédigé par Gemini), un par pilote actif, généré une fois par jour.
-- À exécuter une fois dans Supabase > SQL Editor (source : Database).
-- La table `horoscopes` existe depuis 001 (lecture réservée aux membres) ; seule la fonction Vercel y écrit, via le secret du bot.

create or replace function horoscope_save(secret text, p_day date, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if secret is distinct from (select value from app_secrets where key = 'bot') then raise exception 'secret invalide'; end if;
  insert into horoscopes (day, player_id, body, signals)
  select p_day, pl.id, r->>'body', r->'signals'
    from jsonb_array_elements(p_rows) r
    join players pl on pl.name = r->>'name'
  on conflict (day, player_id) do update set body = excluded.body, signals = excluded.signals, verdict = null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function horoscope_save(text, date, jsonb) from public;
grant execute on function horoscope_save(text, date, jsonb) to anon, authenticated;
