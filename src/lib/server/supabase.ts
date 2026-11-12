import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SECRET_KEY?.trim());
}

export function assertProductionSupabaseConfigured() {
  if (process.env.NODE_ENV !== "production" || isSupabaseConfigured()) return;

  const missing = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"].filter((name) => !process.env[name]?.trim());
  throw new Error(`Production requires ${missing.join(" and ")}. Configure the missing Supabase environment variables.`);
}

export function getSupabaseAdmin(): SupabaseClient | null {
  assertProductionSupabaseConfigured();
  if (!isSupabaseConfigured()) return null;
  adminClient ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return adminClient;
}
