import type { Notification } from "@/lib/types";

/**
 * Seeded notifications.
 *
 * Every row here is one the product could actually have produced. That was not
 * true before: the previous set opened with "Hanne nevnte deg i #samarbeid" and
 * "Rigg og gjennomgang om 19 dager — Du er påmeldt", and TING has no mentions
 * and no event reminders. A demo whose notification list advertises two
 * features that do not exist is worse than an empty one, because the empty one
 * is at least honest.
 *
 * It was also aimed at the wrong people. The set was written around Ingrid,
 * who spans three communities and therefore makes the richest list — and then
 * `lib/mock/demo-personas.ts` deliberately made the reachable personas narrow,
 * for good reasons it explains at length. Nobody rewrote this file, so Kari and
 * Robin, the original two privileged showcase accounts, had none at all. The
 * bell was permanently empty in the only session anyone saw.
 *
 * ── What may appear here ────────────────────────────────────────────────
 *
 * Only the three shapes the database actually writes, copied from the
 * generators so that seeded and live notifications are indistinguishable:
 *
 *   announcement  — notify_announcement(), 20260916180000.
 *                   "Ny kunngjøring: <tittel>" / "<Forfatter> publiserte en
 *                   kunngjøring i <Fellesskap>." → /community/<id>/feed
 *   membership    — request_community_access(), 20260916200000.
 *                   "<Navn> ba om tilgang" / "Forespørselen kom inn til
 *                   <Fellesskap>. Du er administrator der."
 *                   → /community/<id>/requests
 *   membership    — accept_invitation_token(), 20260908150000.
 *                   "Du er nå medlem av <Fellesskap>" → /community/<id>
 *
 * The `mention` and `event` kinds stay in the enum — removing an enum value in
 * PostgreSQL is a rebuild of every column that uses it, which 20260908160000
 * already declined to do for `membership_status` — but nothing seeds them, and
 * nothing should until those features exist.
 *
 * ── Everything below is checkable against the rest of the fixtures ──────
 *
 * Each announcement notice names a post that exists in `posts.ts`, written by
 * that post's real author, in a community the recipient is an active member of,
 * and never one they wrote themselves. Each request notice names an address in
 * `access-requests.ts` and goes only to administrators of the community it was
 * sent to. Timestamps sit just after the thing they are about, so the shift in
 * `fixture-time.ts` keeps them in order.
 *
 * This is a curated snapshot rather than a replay: a real request notifies
 * *every* administrator, and these seed only the ones whose lists are worth
 * looking at. What is asserted in `check-notifications.ts` is that no seeded
 * row grants its recipient something their role does not — not that fan-out is
 * exhaustive.
 */
export const notifications: Notification[] = [
  // ── Lars Bror Kristiansen — the Tryggere administrator ───────────────
  //
  // The single seeded administrator in Tryggere Ruspolitikk receives the
  // request notices. Demo personas are moderators now, so they must not get
  // queue notifications they can no longer act on.
  {
    id: "n-lars-1",
    userId: "lars-bror-kristiansen",
    kind: "membership",
    communityId: "tryggere-ruspolitikk",
    title: "Turid Moen ba om tilgang",
    body: "Forespørselen kom inn til Tryggere Ruspolitikk. Du er administrator der.",
    createdAt: "2026-09-08T09:40:00+02:00",
    read: false,
    href: "/community/tryggere-ruspolitikk/requests",
  },
  {
    id: "n-lars-2",
    userId: "lars-bror-kristiansen",
    kind: "membership",
    communityId: "tryggere-ruspolitikk",
    title: "Maja Solberg ba om tilgang",
    body: "Forespørselen kom inn til Tryggere Ruspolitikk. Du er administrator der.",
    createdAt: "2026-09-05T11:05:00+02:00",
    read: false,
    href: "/community/tryggere-ruspolitikk/requests",
  },

  // ── Kari Moen — the Tryggere showcase persona ────────────────────────
  //
  // Moderator in both Tryggere communities. She still gets announcement
  // notices as an active member, but no request queue notices.
  {
    id: "n-kari-3",
    userId: "demo-tryggere",
    kind: "announcement",
    communityId: "tryggere-ungdom",
    title: "Ny kunngjøring: Høstens kursrekke er klar",
    body: "Hanne Nordbø publiserte en kunngjøring i Tryggere Ungdom.",
    createdAt: "2026-09-05T14:11:00+02:00",
    read: false,
    href: "/community/tryggere-ungdom/feed",
  },
  {
    id: "n-kari-4",
    userId: "demo-tryggere",
    kind: "announcement",
    communityId: "tryggere-ruspolitikk",
    title: "Ny kunngjøring: Høringssvaret om rusreformen er levert",
    body: "Amina Sørhaug publiserte en kunngjøring i Tryggere Ruspolitikk.",
    createdAt: "2026-09-05T08:21:00+02:00",
    read: true,
    href: "/community/tryggere-ruspolitikk/feed",
  },

  // ── Robin Sæther — the Under The Rug showcase persona ────────────────
  //
  // Moderator in Under The Rug and nothing else, which is what keeps that
  // showcase from wandering into a civic NGO. It also bounds this list: Under
  // The Rug has exactly one announcement in `posts.ts` and no access requests
  // in `access-requests.ts`, so one announcement notice is everything the
  // fixture graph can honestly support. The second is his own joining, which
  // is the notification `accept_invitation_token()` writes, dated to the
  // membership in `demo-personas.ts` rather than to something more recent and
  // more convenient.
  {
    id: "n-robin-1",
    userId: "demo-utr",
    kind: "announcement",
    communityId: "under-the-rug",
    title: "Ny kunngjøring: Høstprogrammet er klart",
    body: "Marte Fjeldstad publiserte en kunngjøring i Under The Rug.",
    createdAt: "2026-09-05T17:31:00+02:00",
    read: false,
    href: "/community/under-the-rug/feed",
  },
  {
    id: "n-robin-2",
    userId: "demo-utr",
    kind: "membership",
    communityId: "under-the-rug",
    title: "Du er nå medlem av Under The Rug",
    body: "Invitasjonen er tatt i bruk. Du kan lese og delta i fellesskapet.",
    createdAt: "2023-04-02T10:15:00+02:00",
    read: true,
    href: "/community/under-the-rug",
  },

  // ── Ingrid Hovden — one account across three organisations ───────────
  //
  // Not reachable from a showcase link, and kept anyway: she is the fixture
  // that demonstrates one person holding a different role in each community,
  // and her notification list is where that is most visible. Administrator in
  // Tryggere Ruspolitikk and Tryggere Ungdom, and an ordinary member of
  // Under The Rug, so announcements reach her but request queues do not.
  {
    id: "n-ingrid-2",
    userId: "ingrid",
    kind: "announcement",
    communityId: "under-the-rug",
    title: "Ny kunngjøring: Høstprogrammet er klart",
    body: "Marte Fjeldstad publiserte en kunngjøring i Under The Rug.",
    createdAt: "2026-09-05T17:31:00+02:00",
    read: false,
    href: "/community/under-the-rug/feed",
  },
  {
    id: "n-ingrid-3",
    userId: "ingrid",
    kind: "announcement",
    communityId: "tryggere-ungdom",
    title: "Ny kunngjøring: Høstens kursrekke er klar",
    body: "Hanne Nordbø publiserte en kunngjøring i Tryggere Ungdom.",
    createdAt: "2026-09-05T14:11:00+02:00",
    read: false,
    href: "/community/tryggere-ungdom/feed",
  },
  {
    id: "n-ingrid-4",
    userId: "ingrid",
    kind: "announcement",
    communityId: "tryggere-ruspolitikk",
    title: "Ny kunngjøring: Høringssvaret om rusreformen er levert",
    body: "Amina Sørhaug publiserte en kunngjøring i Tryggere Ruspolitikk.",
    createdAt: "2026-09-05T08:21:00+02:00",
    read: true,
    href: "/community/tryggere-ruspolitikk/feed",
  },

  // ── Jonas Aalborg — one community, one notification ──────────────────
  //
  // An ordinary member of Under The Rug and nothing else. He is here so the
  // fixtures hold at least one account whose list is what most members' lists
  // actually look like: short.
  {
    id: "n-jonas-1",
    userId: "jonas",
    kind: "announcement",
    communityId: "under-the-rug",
    title: "Ny kunngjøring: Høstprogrammet er klart",
    body: "Marte Fjeldstad publiserte en kunngjøring i Under The Rug.",
    createdAt: "2026-09-05T17:31:00+02:00",
    read: false,
    href: "/community/under-the-rug/feed",
  },

  // Sofie Lind has none, which is the honest answer rather than an oversight.
  // She belongs to no community, so no announcement can reach her and no queue
  // is hers to work. Her previous notification announced an invitation to
  // Tryggere Ungdom that does not exist anywhere in the fixtures — the seed
  // creates no invitations and no 'invited' memberships, because
  // 20260908160000 replaced that model — so it described a state the database
  // has never been in.
];
