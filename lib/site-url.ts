import { headers } from "next/headers";

/**
 * The canonical absolute origin of this deployment.
 *
 * Every absolute URL the server hands out — the link in a sign-in email, the
 * link in an invitation, the redirect after an emailed link is exchanged —
 * comes from here, so there is one answer rather than one per call site.
 *
 * The order matters:
 *
 * 1. `SITE_URL`. Server-only and read at runtime, so correcting it needs a
 *    restart rather than a rebuild. This is the one to set in production.
 * 2. `NEXT_PUBLIC_SITE_URL`. Honoured for compatibility, but `NEXT_PUBLIC_*`
 *    values are inlined into the bundle by `next build`, which means a
 *    deployment that adds it after building keeps the old value — usually
 *    `undefined` — until it builds again. That is a sharp edge to hand
 *    somebody operating a server, hence the server-only variable above it.
 * 3. The proxy's forwarded headers, for deployments that set them.
 * 4. The Host header, which is a last resort: behind a reverse proxy that does
 *    not rewrite it, this is the *upstream* address (`localhost:3010`), not
 *    the address a person typed.
 *
 * The `Origin` request header is deliberately never consulted. It is supplied
 * by the caller, so trusting it would let someone ask us to email a link
 * pointing at a host of their choosing.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return normalizeOrigin(configured);

  const header = await headers();
  const proto = header.get("x-forwarded-proto") ?? "http";
  const host = header.get("x-forwarded-host") ?? header.get("host") ?? "localhost:3000";
  const derived = `${proto}://${host}`;

  warnIfUnusable(derived);
  return normalizeOrigin(derived);
}

/**
 * A trailing slash turns `${origin}/auth/callback` into a double slash, which
 * will not match a redirect allowlist entry. Cheap to tolerate, confusing to
 * debug.
 */
function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * A loopback origin in production means the app is describing its own
 * upstream address rather than the site. Links built from it are dead on
 * arrival, and the failure is otherwise silent: the email sends, the link
 * simply goes nowhere the recipient can reach.
 */
function warnIfUnusable(origin: string): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin)) return;

  console.error(
    `[site-url] Resolved the site origin to ${origin} in production. Emailed ` +
      `sign-in and invitation links will point at the server's own port and ` +
      `will not work. Set SITE_URL (for example https://join-ting.no) and ` +
      `restart.`,
  );
}
