import { getSupabase } from './supabase';
import { Player } from './types';

/**
 * Photos des pilotes, rangées dans le bucket privé « avatars » de Supabase (lisible par les membres connectés) :
 * - photo par défaut : defaults/<Nom>.jpg (ou .png, .webp), déposée par l'admin, le nom étant celui du formulaire ;
 * - photo choisie par le pilote : players/<id>/…, prioritaire sur celle par défaut.
 */
export const BUCKET = 'avatars';

// URLs signées gardées en mémoire : les rechargements du direct ne refont pas clignoter les photos.
const signedCache = new Map<string, { url: string; exp: number }>();

export async function attachAvatarUrls(players: Player[]) {
  const sb = await getSupabase();
  if (!sb) return;
  try {
    // photos par défaut : dossier « defaults », ou « players/defaults » s'il a été créé au mauvais niveau
    const byName = new Map<string, string>();
    for (const folder of ['players/defaults', 'defaults']) {
      const { data: files } = await sb.storage.from(BUCKET).list(folder, { limit: 200 });
      for (const f of files ?? []) {
        const base = f.name.replace(/\.(jpe?g|png|webp)$/i, '').toLowerCase();
        if (base !== f.name.toLowerCase()) byName.set(base, `${folder}/${f.name}`);
      }
    }
    const paths = players.map((p) => p.avatarPath ?? byName.get(p.name.toLowerCase()) ?? null);
    const wanted = [...new Set(paths.filter((x): x is string => !!x))];
    if (!wanted.length) return;
    const now = Date.now();
    const missing = wanted.filter((w) => (signedCache.get(w)?.exp ?? 0) <= now);
    if (missing.length) {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(missing, 60 * 60 * 24);
      for (const x of signed ?? []) if (x.signedUrl && x.path) signedCache.set(x.path, { url: x.signedUrl, exp: now + 20 * 3600e3 });
    }
    const url = new Map(wanted.filter((w) => signedCache.has(w)).map((w) => [w, signedCache.get(w)!.url]));
    players.forEach((p, i) => { const path = paths[i]; if (path && url.get(path)) p.avatarUrl = url.get(path)!; });
  } catch {
    /* pas de bucket ou pas de droits : on garde les initiales */
  }
}

/** Recadre au centre en carré et réduit à 320 px (JPEG), pour un fichier léger quelle que soit la photo d'origine. */
export async function squareJpeg(file: File, size = 320): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Image illisible'))), 'image/jpeg', 0.85));
}

export async function uploadMyAvatar(playerId: string, file: File): Promise<string | null> {
  const sb = (await getSupabase())!;
  const blob = await squareJpeg(file);
  const path = `players/${playerId}/avatar-${Date.now()}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (up.error) return up.error.message;
  const { error } = await sb.rpc('set_avatar', { path });
  return error ? error.message : null;
}

export async function clearMyAvatar(): Promise<string | null> {
  const { error } = await (await getSupabase())!.rpc('set_avatar', { path: null });
  return error ? error.message : null;
}
