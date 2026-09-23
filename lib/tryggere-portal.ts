/**
 * What differs between the two Tryggere portals.
 *
 * Foreningen Tryggere Ruspolitikk and Tryggere Ungdom share one portal
 * implementation (`TryggerePortal`): the same composition, the same copy, the
 * same access flow. Everything that is genuinely theirs — name, accent, places,
 * public links, public events — already lives on the community record. What
 * the record has no field for is listed here, keyed by portal slug: the logo
 * file, and the name of the sibling organisation the shared "same account in
 * both" note refers to.
 *
 * Adding a third organisation that should use this portal is one entry below;
 * a community with no entry keeps the generic portal.
 */
export interface PortalLogo {
  /** Path under `public/`. */
  src: string;
  /** Intrinsic pixel size, so the layout reserves the right box. */
  width: number;
  height: number;
}

export interface TryggerePortalBrand {
  logo: PortalLogo;
  /** The other organisation that shares TING accounts with this one. */
  otherOrganisation: string;
  /**
   * Where someone who is not yet a member of the organisation can become one.
   * Left out when the organisation has no such link configured — the portal
   * then shows no "become a member" line at all rather than a guessed address.
   */
  membershipUrl?: string;
}

const brands: Record<string, TryggerePortalBrand> = {
  "tryggere-ruspolitikk": {
    logo: { src: "/brand/tryggere-ruspolitikk-logo.png", width: 1200, height: 289 },
    otherOrganisation: "Tryggere Ungdom",
    membershipUrl: "https://rusreform.no/bli-medlem",
  },
  "tryggere-ungdom": {
    logo: { src: "/brand/tryggere-ungdom-logo.png", width: 713, height: 146 },
    otherOrganisation: "Tryggere Ruspolitikk",
  },
};

export function getTryggerePortalBrand(slug: string): TryggerePortalBrand | undefined {
  return Object.hasOwn(brands, slug) ? brands[slug] : undefined;
}
