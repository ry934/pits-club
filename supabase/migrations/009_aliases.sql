-- 009 : prénoms et surnoms de chaque pilote, pour que l'IA reconnaisse « Rom », « Bap », « Paulito »… dans les Takes.
-- À exécuter une fois dans Supabase > SQL Editor (source : Database).

alter table players add column if not exists aliases text[] not null default '{}';

update players set aliases = array['Grominou', 'Romain', 'Romaing', 'Rom'] where name = 'Romaing';
update players set aliases = array['Charlobelix', 'Charlie', 'Bill', 'Recops'] where name = 'Charlie';
update players set aliases = array['Bapilote', 'Baptiste', 'Bap', 'Bap2'] where name = 'Bap2';
update players set aliases = array['RoroDelRoro', 'Roro'] where name = 'Roro';
update players set aliases = array['Loulou', 'Louane', 'Loana'] where name = 'Louane';
update players set aliases = array['Camtar', 'Cam', 'Camille'] where name = 'Camille';
update players set aliases = array['Paul', 'Paulito'] where name = 'Paul';

-- Modifier les surnoms d'un pilote (admins uniquement).
create or replace function admin_set_aliases(p_player text, p_aliases text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Réservé aux admins'; end if;
  update players
     set aliases = coalesce((select array_agg(distinct btrim(a)) from unnest(p_aliases) a where btrim(a) <> ''), '{}')
   where name = p_player;
  if not found then raise exception 'Pilote introuvable'; end if;
end $$;
revoke all on function admin_set_aliases(text, text[]) from public, anon;
grant execute on function admin_set_aliases(text, text[]) to authenticated;
