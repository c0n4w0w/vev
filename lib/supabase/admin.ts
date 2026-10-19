import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Service-role client. Bypasses row level security entirely.
 *
 * The seed and check scripts use it under plain node — which is why this
 * module does not import `server-only` the way the rest of the data layer
 * does. Application code must go through `createSupabaseServerClient` so the
 * database, not the app, decides what a given person is allowed to see. Two
 * exceptions mint Supabase sign-in tokens with `auth.admin.generateLink`:
 * showcase entry (demo deployments only, lib/demo/entry.ts) and the approval
 * email (app/actions.ts → lib/email-sign-in-link.ts), which runs after the
 * database has authorised the approval and only for the address it returned.
 * The third is the message-attachment bucket (lib/attachment-storage.ts):
 * browsers have no write access to it at all, so the server stores an object
 * once the database has opened the upload for the signed-in person, and
 * removes objects whose row is gone — including the rows of disappearing
 * direct messages whose time is up, which the database chooses itself. It
 * reads nothing and decides nothing.
 * The fourth is the count kept around each password check
 * (lib/account-security.ts): the two functions that count tries per account
 * and per network address take those as arguments, so no client may call
 * them, and the server calls them and nothing else.
 */
export function createSupabaseAdminClient() {
  return createClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
