import type { Membership, User } from "@/lib/types";

/**
 * The accounts a showcase visitor arrives as.
 *
 * Deliberately a separate file from `lib/mock/users.ts` and
 * `lib/mock/communities.ts`. Those describe the fictional organisations and
 * the people in them — content. These two exist only so that a prospect
 * following a link lands somewhere sensible, and their memberships are what
 * makes each showcase show one organisation and not the other.
 *
 * The separation is the mechanism, not a UI filter. TING has no global
 * directory: the sidebar, the switcher and every query return exactly the
 * communities the signed-in account belongs to. Give the Tryggere persona no
 * Under The Rug membership and Under The Rug is not hidden from them — it is
 * genuinely not theirs, enforced by row level security like anyone else's.
 *
 * This is also why Ingrid is not the Tryggere persona. She is the fixture that
 * demonstrates one account spanning two unrelated organisations, which is a
 * good story on its own and the wrong one here: her switcher would list Under
 * The Rug in the middle of a civic-organisation demo.
 *
 * Addresses sit on a subdomain nobody receives mail at. Showcase entry mints a
 * session server-side rather than emailing anything, so no mailbox is needed —
 * and an address that cannot collide with a real person's is one less way for
 * a seed to touch an account it should not.
 */
export const demoPersonas: User[] = [
  {
    id: "demo-tryggere",
    name: "Kari Moen",
    handle: "karimoen",
    initials: "KM",
    email: "demo.tryggere@demo.join-ting.no",
    pronoun: "hun/henne",
    location: "Oslo",
    bio: "Organisasjonsrådgiver. Holder oversikt over medlemmer, høringer og hvem som skal stå i standen.",
    joinedAt: "2023-08-14",
  },
  {
    id: "demo-utr",
    name: "Robin Sæther",
    handle: "robinsaether",
    initials: "RS",
    email: "demo.utr@demo.join-ting.no",
    pronoun: "hen/hen",
    location: "Oslo",
    bio: "Booking og produksjon. Bruker mer tid på strømkurser og bæring enn på å høre på musikk.",
    joinedAt: "2023-04-02",
  },
];

/**
 * What each persona belongs to — and, just as importantly, what it does not.
 *
 * Tryggere: admin in the parent organisation so the membership queue,
 * invitations and the admin-only directory are all reachable; moderator in the
 * youth organisation so the difference between the two roles is visible in one
 * session. No Under The Rug.
 *
 * Under The Rug: admin in the collective and nothing else, so the switcher
 * holds one community and the demo never wanders into a civic NGO.
 */
export const demoPersonaMemberships: Membership[] = [
  {
    userId: "demo-tryggere",
    communityId: "tryggere-ruspolitikk",
    role: "admin",
    status: "active",
    joinedAt: "2023-08-14",
    title: "Organisasjonsrådgiver",
  },
  {
    userId: "demo-tryggere",
    communityId: "tryggere-ungdom",
    role: "moderator",
    status: "active",
    joinedAt: "2024-01-22",
    title: "Kontakt fra moderorganisasjonen",
  },
  {
    userId: "demo-utr",
    communityId: "under-the-rug",
    role: "admin",
    status: "active",
    joinedAt: "2023-04-02",
    title: "Booking og produksjon",
  },
];
