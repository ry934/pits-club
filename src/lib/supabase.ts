import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Client Supabase, ou null en mode démo (aucune variable d'environnement). */
export async function getSupabase(): Promise<SupabaseClient | null> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return null;
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(url, key);
  }
  return client;
}
