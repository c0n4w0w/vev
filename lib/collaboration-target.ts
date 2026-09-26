/**
 * What a collaboration manager types to invite another organisation.
 *
 * There is deliberately no organisation directory, search or autocomplete: TING
 * does not make communities discoverable, and a collaboration must not become
 * a way to find them. The manager enters the one thing they can already know —
 * the organisation's public TING address — either as the bare slug or as its
 * portal URL:
 *
 *   tryggere-ruspolitikk
 *   join-ting.no/tryggere-ruspolitikk
 *   https://join-ting.no/tryggere-ruspolitikk
 *
 * This reduces that to a slug, or refuses. It never guesses: no prefix, no
 * fuzzy matching, and a URL on any host other than TING's own is rejected
 * rather than mined for something slug-shaped. The database then resolves the
 * slug exactly, or not at all (`invite_collaboration_participant_by_slug`).
 *
 * Pure, with no server imports, so the security suite can exercise it directly.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 80;

export type CollaborationTarget = { ok: true; slug: string } | { ok: false };

function asSlug(value: string): string | undefined {
  const candidate = value.toLowerCase();
  return candidate.length <= SLUG_MAX && SLUG.test(candidate) ? candidate : undefined;
}

/**
 * @param allowedHosts exact `host` values (with port where there is one) that
 *   count as TING itself — the public host and this deployment's own origin.
 */
export function parseCollaborationTarget(raw: string, allowedHosts: string[]): CollaborationTarget {
  const input = raw.trim();
  if (!input || input.length > 300) return { ok: false };

  // The bare slug. Case is folded because slugs are lower-case by construction;
  // nothing else is rewritten.
  const bare = asSlug(input);
  if (bare) return { ok: true, slug: bare };

  // Otherwise it must be a TING address. A missing scheme is tolerated for
  // "join-ting.no/slug"; anything the URL parser will not take is refused.
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return { ok: false };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false };
  if (url.username || url.password) return { ok: false };
  const hosts = new Set(allowedHosts.map((host) => host.toLowerCase()));
  if (!hosts.has(url.host.toLowerCase())) return { ok: false };

  // Exactly one path segment: the portal is /<slug>. Deeper paths are other
  // pages, not an organisation's address.
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return { ok: false };
  let segment: string;
  try {
    segment = decodeURIComponent(segments[0]);
  } catch {
    return { ok: false };
  }
  const slug = asSlug(segment);
  return slug ? { ok: true, slug } : { ok: false };
}
