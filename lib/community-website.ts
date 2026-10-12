import type { CommunityPublic } from "@/lib/types";

/**
 * The organisation's own website, for the Overview header.
 *
 * By convention the first entry of a community's `links` is its official
 * website, so the header reads it from the community record rather than
 * naming any organisation. Only an http(s) address counts; a community with
 * none returns undefined and the header keeps its TING portal link.
 */
export function communityWebsite(
  community: Pick<CommunityPublic, "links">,
): { href: string; label: string } | undefined {
  const href = community.links[0]?.href;
  if (!href) return undefined;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return { href: url.href, label: url.hostname.replace(/^www\./, "") };
  } catch {
    return undefined;
  }
}
