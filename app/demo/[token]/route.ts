import { NextResponse, type NextRequest } from "next/server";
import { enterShowcase } from "@/lib/demo/entry";
import { siteOrigin } from "@/lib/site-url";

/**
 * Showcase entry point: `/demo/<token>`.
 *
 * A route handler rather than a page, because the whole job is to establish a
 * session and redirect — there is nothing to render, and nothing should be
 * cached.
 *
 * Every failure is a 404, including "demo mode is off" and "that token is
 * wrong". A 403 would confirm that the route exists and that tokens are the
 * thing it wants; a 404 says only that there is nothing here, which is also
 * exactly what production should say.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext<"/demo/[token]">) {
  const { token } = await context.params;
  const result = await enterShowcase(token);

  if (!result.ok) {
    // Deliberately uniform. The reason is logged server-side where an operator
    // can see it; the visitor learns nothing either way.
    return new NextResponse(null, { status: 404 });
  }

  const origin = await siteOrigin();
  const response = NextResponse.redirect(`${origin}${result.landing}`);
  // A demo link gets passed around. Nothing about this response should be
  // stored by a CDN or a shared cache.
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
