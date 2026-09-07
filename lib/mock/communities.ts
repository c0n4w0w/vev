import type { Channel, ChannelGroup, Community, Membership } from "@/lib/types";

/**
 * The three showcase communities.
 *
 * Tryggere Ruspolitikk and Tryggere Ungdom are related organisations — the
 * latter is the youth organisation of the former, and their content says so.
 * Under The Rug is an entirely separate organisation with no connection to
 * either; it is here because it was an early adopter, and nothing in its
 * content should suggest otherwise.
 *
 * They share a platform and nothing else: separate members, roles, channels,
 * events and branding.
 */
export const communities: Community[] = [
  {
    id: "tryggere-ruspolitikk",
    slug: "tryggere-ruspolitikk",
    name: "Tryggere Ruspolitikk",
    tagline: "Kunnskapsbasert rusreform og skadereduksjon",
    publicDescription:
      "Tryggere Ruspolitikk er en medlemsorganisasjon som arbeider for en ruspolitikk bygget på helsefaglig kunnskap i stedet for straff. Vi driver med opplysningsarbeid, høringssvar og skadereduksjon i praksis. Er du medlem, frivillig eller samarbeidspartner, logger du inn her.",
    about:
      "Her koordinerer vi lokallag, høringsarbeid, standvakter og festivalsesongen. Alt av fagmateriell og maler ligger i #pagaende-prosjekter. Er du usikker på hvor noe hører hjemme, spør i #generelt.",
    location: "Oslo, Bergen, Trondheim, Tromsø",
    foundedYear: 2016,
    branding: {
      accent: "#2f5a73",
      accentSoft: "#e7eef2",
      monogram: "TR",
      markStyle: "sans",
    },
    accessPolicy: "request-to-join",
    memberCount: 214,
    links: [
      { label: "tryggereruspolitikk.no", href: "https://tryggereruspolitikk.no" },
      { label: "Bli medlem", href: "https://tryggereruspolitikk.no/medlem" },
      { label: "Høringssvar 2026", href: "https://tryggereruspolitikk.no/horinger" },
    ],
  },
  {
    id: "tryggere-ungdom",
    slug: "tryggere-ungdom",
    name: "Tryggere Ungdom",
    tagline: "Ungdomsorganisasjonen for en tryggere ruspolitikk",
    publicDescription:
      "Tryggere Ungdom er ungdomsorganisasjonen til Tryggere Ruspolitikk. Vi lager møteplasser, kurs og aktiviteter for unge mellom 15 og 26, og jobber for at unge selv skal bli hørt når ruspolitikken utformes. Alt vi arrangerer er gratis, og du trenger ingen forkunnskaper for å bli med.",
    about:
      "Her planlegger vi aktiviteter, kurs og turer, og fordeler oppgaver mellom lokallagene i Oslo, Bergen og Trondheim. Vi er rundt førti aktive frivillige. Er du ny, si hei i #presentasjoner — det finnes ingen dumme spørsmål her.",
    location: "Oslo, Bergen, Trondheim",
    foundedYear: 2019,
    branding: {
      accent: "#3f7f77",
      accentSoft: "#e7efee",
      monogram: "TU",
      markStyle: "sans",
    },
    accessPolicy: "request-to-join",
    memberCount: 96,
    links: [
      { label: "tryggereungdom.no", href: "https://tryggereungdom.no" },
      { label: "Bli frivillig", href: "https://tryggereungdom.no/frivillig" },
    ],
  },
  {
    id: "under-the-rug",
    slug: "under-the-rug",
    name: "Under The Rug",
    tagline: "Rave- og kulturkollektiv i Oslo",
    publicDescription:
      "Under The Rug er et uavhengig kollektiv som lager rave, konserter og sammenkomster i rom som vanligvis står tomme. Vi drives av frivillige, og alt overskudd går tilbake til artistene. Arrangementene våre er åpne for alle, men fellesskapet her er for medlemmer, frivillige og samarbeidspartnere.",
    about:
      "Kollektivet ble startet i en kjeller på Tøyen i 2019. I dag er vi rundt seksti frivillige som planlegger og gjennomfører åtte til ti arrangementer i året. Dette rommet brukes til produksjonsplanlegging, vaktlister, booking og fagsnakk mellom arrangementene.",
    location: "Oslo",
    foundedYear: 2019,
    branding: {
      accent: "#9a5a3c",
      accentSoft: "#f4ebe4",
      monogram: "UTR",
      markStyle: "serif",
    },
    accessPolicy: "request-to-join",
    memberCount: 58,
    links: [
      { label: "undertherug.no", href: "https://undertherug.no" },
      { label: "Program høsten 2026", href: "https://undertherug.no/program" },
    ],
  },
];

export const channelGroups: ChannelGroup[] = [
  { id: "generelt", label: "Generelt" },
  { id: "prosjekter", label: "Prosjekter" },
];

const channelBlueprint: Omit<Channel, "communityId" | "id">[] = [
  {
    groupId: "generelt",
    name: "generelt",
    purpose: "Løs prat, spørsmål og alt som ikke passer andre steder.",
  },
  {
    groupId: "generelt",
    name: "kunngjoringer",
    purpose: "Viktige beskjeder til alle. Kun moderatorer og administratorer skriver her.",
    readOnly: true,
  },
  {
    groupId: "generelt",
    name: "presentasjoner",
    purpose: "Ny her? Skriv noen linjer om deg selv.",
  },
  {
    groupId: "prosjekter",
    name: "pagaende-prosjekter",
    purpose: "Status og oppfølging på det vi jobber med akkurat nå.",
  },
  {
    groupId: "prosjekter",
    name: "arrangementer",
    purpose: "Planlegging, vaktlister og praktisk rundt arrangementene våre.",
  },
  {
    groupId: "prosjekter",
    name: "samarbeid",
    purpose: "Henvendelser og samtaler med andre organisasjoner.",
  },
];

export const channels: Channel[] = communities.flatMap((community) =>
  channelBlueprint.map((channel) => ({
    ...channel,
    communityId: community.id,
    id: `${community.id}--${channel.name}`,
  })),
);

export const memberships: Membership[] = [
  // Ingrid — three communities, three different roles, two unrelated
  // organisations. This is the product concept in one row set.
  {
    userId: "ingrid",
    communityId: "tryggere-ruspolitikk",
    role: "admin",
    status: "active",
    joinedAt: "2024-02-11",
    title: "Frivilligkoordinator",
  },
  {
    userId: "ingrid",
    communityId: "tryggere-ungdom",
    role: "moderator",
    status: "active",
    joinedAt: "2024-09-02",
    title: "Kontakt fra moderorganisasjonen",
  },
  {
    userId: "ingrid",
    communityId: "under-the-rug",
    role: "member",
    status: "active",
    joinedAt: "2024-06-03",
    title: "Frivillig, lyd",
  },

  // Jonas — a single community.
  {
    userId: "jonas",
    communityId: "under-the-rug",
    role: "member",
    status: "active",
    joinedAt: "2025-08-30",
    title: "Artist",
  },

  // Sofie — no memberships, one open invitation.
  {
    userId: "sofie",
    communityId: "tryggere-ungdom",
    role: "member",
    status: "invited",
    joinedAt: "2026-09-03",
    invitedBy: "hanne",
  },

  // Tryggere Ruspolitikk
  { userId: "amina", communityId: "tryggere-ruspolitikk", role: "admin", status: "active", joinedAt: "2023-09-04", title: "Fagansvarlig" },
  { userId: "nadia", communityId: "tryggere-ruspolitikk", role: "moderator", status: "active", joinedAt: "2024-05-30", title: "Erfaringskonsulent" },
  { userId: "kristoffer", communityId: "tryggere-ruspolitikk", role: "member", status: "active", joinedAt: "2023-11-19", title: "Frivillig, Oslo" },
  { userId: "linn", communityId: "tryggere-ruspolitikk", role: "member", status: "active", joinedAt: "2024-08-27", title: "Lokallag Tromsø" },
  { userId: "petter", communityId: "tryggere-ruspolitikk", role: "member", status: "active", joinedAt: "2025-02-14", title: "Frivillig, Trondheim" },
  { userId: "elise", communityId: "tryggere-ruspolitikk", role: "member", status: "active", joinedAt: "2025-01-20", title: "Juridisk bidragsyter" },
  { userId: "oskar", communityId: "tryggere-ruspolitikk", role: "member", status: "requested", joinedAt: "2026-09-04" },

  // Tryggere Ungdom
  { userId: "hanne", communityId: "tryggere-ungdom", role: "admin", status: "active", joinedAt: "2023-01-16", title: "Ungdomskoordinator" },
  { userId: "mathea", communityId: "tryggere-ungdom", role: "moderator", status: "active", joinedAt: "2024-04-15", title: "Aktivitetsansvarlig" },
  { userId: "adrian", communityId: "tryggere-ungdom", role: "member", status: "active", joinedAt: "2025-09-08", title: "Frivillig, Bergen" },
  { userId: "petter", communityId: "tryggere-ungdom", role: "member", status: "active", joinedAt: "2025-03-03", title: "Frivillig, Trondheim" },
  { userId: "nadia", communityId: "tryggere-ungdom", role: "member", status: "active", joinedAt: "2025-06-11", title: "Erfaringskonsulent" },

  // Under The Rug
  { userId: "marte", communityId: "under-the-rug", role: "admin", status: "active", joinedAt: "2023-05-22", title: "Kurator" },
  { userId: "vilde", communityId: "under-the-rug", role: "admin", status: "active", joinedAt: "2023-06-12", title: "Produsent" },
  { userId: "eirik", communityId: "under-the-rug", role: "moderator", status: "active", joinedAt: "2024-03-07", title: "Lys og scene" },
  { userId: "sindre", communityId: "under-the-rug", role: "moderator", status: "active", joinedAt: "2023-02-28", title: "Lyd og teknikk" },
  { userId: "oskar", communityId: "under-the-rug", role: "member", status: "active", joinedAt: "2024-01-09", title: "Grafisk design" },
  { userId: "tobias", communityId: "under-the-rug", role: "member", status: "active", joinedAt: "2024-09-15", title: "Booking" },
];
