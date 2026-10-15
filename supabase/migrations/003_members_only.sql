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
