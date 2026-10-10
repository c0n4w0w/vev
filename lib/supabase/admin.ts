import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Service-role client. Bypasses row level security entirely.
 *
 * The seed and check scripts use it under plain node — which is why this
 * module does not import `server-only` the way the rest of the data layer
 * does. Application code must go through `createSupabaseServerClient` so the
 * database, not the app, decides what a given person is allowed to see. The
 * exceptions only mint Supabase sign-in tokens with `auth.admin.generateLink`:
 * showcase entry (demo deployments only, lib/demo/entry.ts) and the approval
 * email (app/actions.ts → lib/email-sign-in-link.ts), which runs after the
 * database has authorised the approval and only for the address it returned.
 */
export function createSupabaseAdminClient() {
  return createClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
