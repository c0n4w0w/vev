import "server-only";

import { siteOrigin } from "@/lib/site-url";

/**
 * Whether a state-changing request to a route handler came from this site.
 *
 * A server action gets this check from Next; a route handler has to make it
 * itself. The session cookie is SameSite=Lax already, so this is the second
 * lock, not the only one. A request with no Origin header at all is refused:
 * every browser sends one on POST and DELETE.
 */
export async function isSameOrigin(request: Request): Promise<boolean> {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  try {
    allowed.add(new URL(await siteOrigin()).origin);
  } catch {
    // No usable configured origin: the request's own origin is the only one.
  }
  return allowed.has(origin);
}
