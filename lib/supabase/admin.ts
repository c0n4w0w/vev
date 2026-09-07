import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Service-role client. Bypasses row level security entirely.
 *
 * Only the seed script uses it, and that runs under plain node — which is why
 * this module does not import `server-only` the way the rest of the data layer
 * does. Application code must go through `createSupabaseServerClient` so the
 * database, not the app, decides what a given person is allowed to see.
 */
export function createSupabaseAdminClient() {
  return createClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
