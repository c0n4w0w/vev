import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { clientAddressFrom, trustedProxyCount } from "@/lib/client-ip";
import { withAuthForwarding } from "@/lib/supabase/auth-forwarding";
import { supabaseAnonKey, supabaseSecretKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The `fetch` under a server-side client for this request: the ordinary one,
 * except that Supabase Auth is told the caller's network address on the
 * endpoints it limits per address — when the deployment has a secret key and
 * a proxy it trusts to say what that address is. See auth-forwarding.ts for
 * what that does and, more to the point, does not touch.
 */
async function requestFetch(): Promise<typeof fetch> {
  const secretKey = supabaseSecretKey();
  warnIfHalfConfigured(secretKey);
  return withAuthForwarding((input, init) => fetch(input, init), {
    supabaseUrl: supabaseUrl(),
    secretKey,
    clientAddress: clientAddressFrom((await headers()).get("x-forwarded-for"), trustedProxyCount()),
  });
}

let warnedAboutProxy = false;

/**
 * A secret key with no proxy to trust forwards nothing — correctly, since
 * there is no address worth forwarding — but silently, and the deployment
 * believes it is protected. Said once, in production only.
 */
function warnIfHalfConfigured(secretKey: string | undefined): void {
  if (warnedAboutProxy || !secretKey || trustedProxyCount() > 0) return;
  if (process.env.NODE_ENV !== "production") return;
  warnedAboutProxy = true;
  console.error(
    "[auth-forwarding] SUPABASE_SECRET_KEY is set but TRUSTED_PROXY_COUNT is not, so no caller address " +
      "is trusted and none is forwarded to Supabase Auth. Its limits apply to this server as a whole. " +
      "Set TRUSTED_PROXY_COUNT to the number of your own proxies in front of the app (1 behind nginx).",
  );
}

/**
 * Request-scoped Supabase client for Server Components, Server Actions and
 * Route Handlers.
 *
 * It carries the caller's session, so every query runs as that user and row
 * level security decides what comes back. A new client per request is required
 * — reusing one would leak a session between requests.
 *
 * It is created with the public key and stays that way. The secret key that
 * address forwarding needs is never this client's key.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    global: { fetch: await requestFetch() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. The proxy refreshes the
          // session on every request, so there is nothing to recover here.
        }
      },
    },
  });
}

/**
 * A client that keeps nothing: for proving a password or an emailed link
 * without touching this request's own session until the proof is known to be
 * good. Public key, no cookies, no stored session.
 */
export async function createSupabaseScratchClient() {
  return createClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: await requestFetch() },
  });
}
