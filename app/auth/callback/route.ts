import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site-url";

/**
 * Where the emailed sign-in link lands. Exchanges the one-time code for a
 * session cookie, then forwards to whatever the person was trying to reach.
 *
 * The destination is built from the deployment's configured origin rather than
 * from the incoming request, so it does not depend on what the proxy in front
 * of this process happens to put in the Host header.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Not `new URL(request.url).origin`. Behind a reverse proxy that does not
  // rewrite the Host header, that is the upstream address the proxy dialled
  // (localhost:3010), so a successful sign-in bounced the person to a port on
  // the server rather than to the site they came from.
  const origin = await siteOrigin();
  const code = searchParams.get("code");
  const next = searchParams.get("neste");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeRedirect(next)}`);
    }
  }

  // A code rather than a sentence: the sign-in page words it in the language of
  // wherever the person was heading, which is why `neste` comes back too.
  const back = next ? `&neste=${encodeURIComponent(safeRedirect(next))}` : "";
  return NextResponse.redirect(`${origin}/login?feil=lenke${back}`);
}

/**
 * Only same-site paths. Without this, a crafted sign-in link could bounce
 * someone to another host immediately after authenticating them.
 */
function safeRedirect(next: string | null): string {
  if (!next) return "/home";
  if (!next.startsWith("/") || next.startsWith("//")) return "/home";
  return next;
}
