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
