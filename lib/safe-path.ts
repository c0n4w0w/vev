/**
 * Return destinations that arrive in a query string.
 *
 * Only a path on this site is ever accepted: it has to start with a single
 * slash, so `//host`, `https://host` and `/\host` (which browsers read as
 * `//host`) are all refused. Anything else falls back to a fixed default. The
 * auth callback applies the same rule again when it redirects, and builds the
 * result onto the configured origin, so this is a second line, not the only one.
 */
export function safeInternalPath(next: string | undefined, fallback = "/home"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

/**
 * The portal slug in `/some-slug`, when that is all the path is. Used to offer
 * a "back to <organisation>" link; the name still has to come from a real
 * portal, so a made-up slug produces nothing.
 */
export function portalSlugOf(path: string): string | undefined {
  const match = /^\/([a-z0-9][a-z0-9-]{0,62})$/.exec(path);
  return match?.[1];
}
