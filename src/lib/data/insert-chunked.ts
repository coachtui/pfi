import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const CHUNK = 500;

export async function insertChunked(
  supabase: SupabaseClient,
  table: string,
  rows: unknown[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
  }
}
