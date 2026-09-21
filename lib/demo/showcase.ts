/**
 * The showcases.
 *
 * A showcase is not a build, a tenant or a branch. It is a persona plus the
 * memberships that persona has — and because TING has no global directory,
 * what a visitor sees is already a pure function of that. The Tryggere
 * showcase hides Under The Rug for exactly the same reason any member is
 * hidden from any community they are not in: row level security, not a filter.
 *
 * Nothing here is a secret. The entry tokens live in the environment; these
 * are just the names and destinations.
 */
export interface Showcase {
  /** URL-safe key, used in `DEMO_TOKEN_<KEY>` and for logging. */
  id:
    | "tryggere"
    | "tryggere_member"
    | "utr"
    | "utr_member"
    | "utr_admin"
    | "ftr_admin"
    | "tu_admin";
  label: string;
  /** Fixture account this showcase signs a visitor in as. */
  personaEmail: string;
  /** Where the visitor lands once the session exists. */
  landing: string;
  /** One line for the operator, not shown to visitors. */
  demonstrates: string;
}

export const showcases: Showcase[] = [
  {
    id: "utr_admin",
    label: "Under The Rug (admin)",
    personaEmail: "octavio@demo.join-ting.no",
    landing: "/community/under-the-rug",
    demonstrates:
      "Under The Rug as the designated administrator: member administration, role management, access requests and account links.",
  },
  {
    id: "ftr_admin",
    label: "Tryggere Ruspolitikk (admin)",
    personaEmail: "lars.bror@demo.join-ting.no",
    landing: "/community/tryggere-ruspolitikk",
    demonstrates:
      "Foreningen Tryggere Ruspolitikk as the designated administrator: private member administration, access requests, account links and moderator assignment.",
  },
  {
    id: "tu_admin",
    label: "Tryggere Ungdom (admin)",
    personaEmail: "emma@demo.join-ting.no",
    landing: "/community/tryggere-ungdom",
    demonstrates:
      "Tryggere Ungdom as the designated administrator: private member administration, access requests, account links and moderator assignment.",
  },
  {
    id: "tryggere",
    label: "Tryggere Ruspolitikk / Tryggere Ungdom",
    personaEmail: "demo.tryggere@demo.join-ting.no",
    landing: "/community/tryggere-ruspolitikk",
    demonstrates:
      "Civic organisation: admin-only member directory, staff-only DMs, access requests, invitations, announcements.",
  },
  {
    id: "tryggere_member",
    label: "Tryggere Ruspolitikk / Tryggere Ungdom (ordinary member)",
    personaEmail: "demo.tryggere.member@demo.join-ting.no",
    landing: "/community/tryggere-ruspolitikk",
    demonstrates:
      "Civic organisation as an ordinary member: FTR Trøndelag selected, Tryggere Ungdom without a local group, no admin controls.",
  },
  {
    id: "utr",
    label: "Under The Rug",
    personaEmail: "demo.utr@demo.join-ting.no",
    landing: "/community/under-the-rug",
    demonstrates:
      "Independent collective: open member directory, member DMs, active public event programme, custom emoji.",
  },
  {
    id: "utr_member",
    label: "Under The Rug (ordinary member)",
    personaEmail: "demo.utr.member@demo.join-ting.no",
    landing: "/community/under-the-rug",
    demonstrates:
      "Independent collective as an ordinary member: directory, channels, events, feed, and member-to-member DMs without admin controls.",
  },
];

export function findShowcase(id: string): Showcase | undefined {
  return showcases.find((showcase) => showcase.id === id);
}

/**
 * The environment variable holding a showcase's entry token.
 *
 * Kept out of source deliberately. A token in the repository is a token in
 * every clone, every fork and every CI log.
 */
export function tokenEnvName(showcase: Showcase): string {
  return `DEMO_TOKEN_${showcase.id.toUpperCase()}`;
}
