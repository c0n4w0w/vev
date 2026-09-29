/**
 * The explicit relationships between two communities, shown as a small card on
 * the Overview.
 *
 * This is deliberately not a directory or a recommendation: each entry is one
 * intentional, hand-written pointer from one community to another, keyed by
 * the stable portal slug (never the display name). A community with no entry
 * shows nothing. Adding a relationship is one entry here plus its copy keys.
 */
import type { MessageKey } from "@/lib/i18n";
import { getTryggerePortalBrand } from "@/lib/tryggere-portal";
import type { Membership } from "@/lib/types";

export interface RelatedCommunityConfig {
  /** Portal slug of the community whose Overview shows the card. */
  sourceSlug: string;
  /** Portal slug of the community the card points to. */
  targetSlug: string;
  /** Where someone who is not yet a member of the target organisation joins. */
  membershipUrl: string;
  /** Optional bold first line, then the explanatory body. */
  copy: { lead?: MessageKey; body: MessageKey };
}

/**
 * `membershipUrl` is left out where the target organisation's canonical link
 * already lives in `tryggere-portal.ts`, so it is defined once. It is given
 * here only where that file has none.
 */
type RelationshipEntry = Omit<RelatedCommunityConfig, "membershipUrl"> & { membershipUrl?: string };

const relationships: RelationshipEntry[] = [
  {
    sourceSlug: "tryggere-ruspolitikk",
    targetSlug: "tryggere-ungdom",
    membershipUrl: "https://tryggere-ungdom.no",
    copy: { lead: "overview.related.ungdom.lead", body: "overview.related.ungdom.body" },
  },
  {
    sourceSlug: "tryggere-ungdom",
    targetSlug: "tryggere-ruspolitikk",
    copy: { body: "overview.related.ruspolitikk.body" },
  },
];

export function getRelatedCommunityConfig(sourceSlug: string): RelatedCommunityConfig | undefined {
  const entry = relationships.find((candidate) => candidate.sourceSlug === sourceSlug);
  const membershipUrl =
    entry?.membershipUrl ?? getTryggerePortalBrand(entry?.targetSlug ?? "")?.membershipUrl;
  return entry && membershipUrl ? { ...entry, membershipUrl } : undefined;
}

/** Only an active membership counts; pending, invited, removed and left do not. */
export function isActiveMember(membership: Pick<Membership, "status"> | undefined): boolean {
  return membership?.status === "active";
}

/**
 * Where the card's community link goes. Members go straight into the
 * authenticated community; everyone else goes through its public portal.
 */
export function relatedCommunityHref(
  target: { id: string; slug: string },
  joined: boolean,
): string {
  return joined ? `/community/${target.id}` : `/${target.slug}`;
}
