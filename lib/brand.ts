/**
 * Product identity in one place.
 *
 * `PUBLIC_HOST` is the canonical public domain, shown next to a community's
 * portal slug as the "type this into your address bar" hint. Display only —
 * no scheme, no path.
 *
 * The absolute origin used to build links that leave the system (invitation
 * emails) is a separate, deploy-time concern: `NEXT_PUBLIC_SITE_URL`, read in
 * `app/actions.ts`.
 */
export const PUBLIC_HOST = "join-ting.no";
