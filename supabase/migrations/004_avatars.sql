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
