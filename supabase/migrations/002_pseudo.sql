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
