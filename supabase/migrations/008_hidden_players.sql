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
