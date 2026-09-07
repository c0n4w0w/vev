import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where the emailed sign-in link lands. Exchanges the one-time code for a
 * session cookie, then forwards to whatever the person was trying to reach.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("neste");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeRedirect(next)}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?feil=Lenken+er+brukt+eller+utl%C3%B8pt`);
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
