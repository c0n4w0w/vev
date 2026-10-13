import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { clientAddressFrom, trustedProxyCount } from "@/lib/client-ip";
import { withAuthForwarding } from "@/lib/supabase/auth-forwarding";
import { supabaseSecretKey } from "@/lib/supabase/env";

/**
 * Keeps the Supabase session fresh.
 *
 * Server Components cannot write cookies, so without this a refreshed access
 * token would never make it back to the browser and people would be logged out
 * at seemingly random moments.
 *
 * This is not the authorisation layer. Access decisions live in the route
 * guards and, ultimately, in row level security — the proxy only moves tokens.
 *
 * The refresh is the Auth call every member's browser causes most often, and
 * Supabase limits it per network address. So this is where telling Auth the
 * caller's own address matters most (lib/supabase/auth-forwarding.ts): without
 * it every refresh in the membership is counted against this server.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    global: {
      fetch: withAuthForwarding((input, init) => fetch(input, init), {
        supabaseUrl: url,
        secretKey: supabaseSecretKey(),
        clientAddress: clientAddressFrom(request.headers.get("x-forwarded-for"), trustedProxyCount()),
      }),
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Responses that set auth cookies must not be cached by a CDN, or one
        // person's token can be handed to the next visitor.
        for (const [header, value] of Object.entries(headers)) {
          response.headers.set(header, value);
        }
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation — and the
    // message-attachment upload. The proxy buffers a request's body so it can
    // be read twice, capped at 10 MB, and an attachment may be 25 MiB; that
    // route validates the session itself and reads nothing until the caller
    // is known to be allowed to send it.
    "/((?!_next/static|_next/image|favicon.ico|community/[^/]+/attachments/upload$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
