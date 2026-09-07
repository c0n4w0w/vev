"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

/** Browser client. Used for auth callbacks and, later, realtime channels. */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey());
}
