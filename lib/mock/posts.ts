import type { Post } from "@/lib/types";

/**
 * Seed shape for a post.
 *
 * `commentCount` is absent on purpose: it is derived by the database from the
 * comment rows in `lib/mock/comments.ts`. `reactions` stays, but as the source
 * for individual `post_reactions` rows — the seed no longer writes the
 * aggregate, it writes the rows the aggregate is computed from.
 */
export type SeedPost = Omit<Post, "commentCount" | "reactions"> & {
  /** Human-readable fixture key; the seed resolves it to posts.local_group_id. */
  localGroupName?: string;
  /** Subgroup slug; the seed resolves it to posts.subgroup_id. */
  subgroupSlug?: string;
  /**
   * Seed source for built-in reaction rows. The database stores one row per
   * person per emoji and derives the aggregate; this aggregate-looking shape
   * is only a compact way to write the fixtures.
   */
  reactions: { emoji: string; userIds: string[] }[];
};

/**
 * Feed content. Everything here appears in the feed; an `announcement` is a
 * kind of post rather than a separate destination, and a pinned one is also
 * surfaced on the community overview.
 *
 * The feed is the organisation's official surface: every post here is written
 * by an admin or moderator of its community (`posts_insert` enforces the same
 * for real writes, and `scripts/check-content.ts` for these fixtures). Members
 * take part through comments, reactions and channels. A post with
 * `localGroupName` is readable only by that group and the community's admins;
 * one with `subgroupSlug` only by that subgroup's members and the community's
 * moderators and admins.
 */
export const posts: SeedPost[] = [
  // ── Tryggere Ruspolitikk ──────────────────────────────────────────────
  {
    id: "p-tr-safe-space-1",
    communityId: "tryggere-ruspolitikk",
    subgroupSlug: "safe-space-frivillige",
    authorId: "erlend-thonstad",
    kind: "post",
    title: "Vaktliste for Safe-Space i høst",
    body:
      "Vaktlisten for høstens arrangementer ligger i #Safe-Space frivillige. Skriv deg på de kveldene du kan, så setter vi opp par med minst én erfaren frivillig på hver vakt.",
    // Same morning slot the day before FIXTURE_TODAY. It was dated the 18th —
    // after the fixture clock's "now" — so on a seed run early in the day it
    // landed hours in the future and outranked posts created at now().
    createdAt: "2026-09-17T10:15:00+02:00",
    reactions: [{ emoji: "👍", userIds: ["kristoffer"] }],
  },
  {
    id: "p-tr-local-1",
    communityId: "tryggere-ruspolitikk",
    localGroupName: "FTR Trøndelag",
    authorId: "demo-tryggere",
    kind: "post",
    title: "Plan for medlemsmøtet i Trondheim",
    body:
      "Vi møtes på Frivilligsentralen torsdag 24. september. Første halvtime bruker vi på høstens standvakter, så fordeler vi hvem som følger opp møtet med kommunen.\n\nJeg tar med utskrifter av notatet Nadia la inn i #pagaende-prosjekter. Si fra hvis du vil holde en kort innledning.",
    createdAt: "2026-09-17T18:10:00+02:00",
    reactions: [{ emoji: "👍", userIds: ["petter", "amina"] }],
  },
  {
    id: "p-tr-local-2",
    communityId: "tryggere-ruspolitikk",
    localGroupName: "FTR Trøndelag",
    authorId: "demo-tryggere",
    kind: "post",
    body:
      "Jeg har reservert møterommet i Trondheim fram til klokka 20.30. Hvis noen kan komme ti minutter før og hjelpe med kaffe og stoler, blir jeg veldig glad.",
    createdAt: "2026-09-16T09:25:00+02:00",
    reactions: [{ emoji: "☕", userIds: ["petter"] }],
  },
  {
    id: "p-tr-1",
    communityId: "tryggere-ruspolitikk",
    authorId: "amina",
    kind: "announcement",
    pinned: true,
    title: "Høringssvaret om rusreformen er levert",
    body:
      "Vi leverte høringssvaret til Helse- og omsorgsdepartementet i går kveld, tre timer før fristen. Takk til alle som leste korrektur i helgen — særlig Elise, som gikk gjennom hele kapittel fire på en søndag.\n\nHovedpunktene våre er uendret fra styremøtet i august: avkriminalisering av bruk og besittelse til eget forbruk, rettighetsfestet lavterskeltilbud i alle kommuner, og en forpliktende opptrappingsplan for skadereduksjon. Hele svaret ligger i #pagaende-prosjekter.",
    createdAt: "2026-09-05T08:20:00+02:00",
    reactions: [
      { emoji: "👏", userIds: ["ingrid", "nadia", "kristoffer", "linn", "petter", "elise"] },
      { emoji: "❤️", userIds: ["nadia", "linn"] },
    ],
  },
  {
    id: "p-tr-2",
    communityId: "tryggere-ruspolitikk",
    authorId: "nadia",
    kind: "post",
    body:
      "Var på Stortinget i formiddag sammen med to fra brukerorganisasjonene. Kort oppsummert: helsekomiteen kjenner tallene nå, men de spør fortsatt om hva som skjer med ungdommene. Vi trenger et bedre svar på det spørsmålet enn det vi har i dag.\n\nJeg skriver et notat i løpet av uka. Si fra hvis du vil lese det før det går videre.",
    createdAt: "2026-09-04T15:42:00+02:00",
    reactions: [{ emoji: "🙏", userIds: ["amina", "ingrid", "elise"] }],
  },
  {
    id: "p-tr-3",
    communityId: "tryggere-ruspolitikk",
    authorId: "ingrid",
    kind: "post",
    title: "Vaktlister for festivalsesongen er lagt ut",
    body:
      "Alle standvakter fram til oktober ligger nå i #arrangementer. Vi mangler fortsatt fire personer på lørdagsvakten i Bergen den 19. september, og to i Trondheim uka etter.\n\nDu trenger ingen forkunnskaper for å stå i standen. Vi har en halvtimes gjennomgang før hver vakt, og du står alltid sammen med noen som har gjort det før.",
    createdAt: "2026-09-02T11:05:00+02:00",
    reactions: [{ emoji: "✋", userIds: ["petter", "kristoffer", "linn"] }],
  },
  {
    id: "p-tr-4",
    communityId: "tryggere-ruspolitikk",
    authorId: "lars-bror-kristiansen",
    kind: "post",
    body:
      "Fra Tromsø: kommunen har sagt ja til å møte oss om lavterskeltilbudet i november. Det tok halvannet år og elleve e-poster, men nå står det i kalenderen.",
    createdAt: "2026-08-29T09:15:00+02:00",
    reactions: [
      { emoji: "🎉", userIds: ["amina", "ingrid", "nadia", "petter"] },
      { emoji: "👏", userIds: ["kristoffer"] },
    ],
  },
  {
    id: "p-tr-5",
    communityId: "tryggere-ruspolitikk",
    authorId: "amina",
    kind: "announcement",
    title: "Årsmøtet blir 14. november i Oslo",
    body:
      "Datoen er endelig satt. Årsmøtet holdes lørdag 14. november på Litteraturhuset, med digital deltakelse for dem som ikke kan møte fysisk.\n\nSaker som skal behandles må være styret i hende senest 17. oktober. Innkalling med fullstendig saksliste kommer i midten av oktober.",
    createdAt: "2026-08-26T13:00:00+02:00",
    reactions: [{ emoji: "📅", userIds: ["ingrid", "elise", "linn"] }],
  },

  // ── Tryggere Ungdom ───────────────────────────────────────────────────
  {
    id: "p-tu-1",
    communityId: "tryggere-ungdom",
    authorId: "hanne",
    kind: "announcement",
    pinned: true,
    title: "Høstens kursrekke er klar",
    body:
      "Fire kvelder i Oslo, to i Bergen og to i Trondheim. Vi går gjennom skadereduksjon i praksis, hvordan du snakker med noen som har det vanskelig, og hva du gjør hvis det skjærer seg på en fest.\n\nAlt er gratis, og du trenger ingen forkunnskaper. Ta med en venn hvis du synes det er skummelt å komme alene — det er helt greit, og flere gjør det enn du tror.",
    createdAt: "2026-09-05T14:10:00+02:00",
    reactions: [
      { emoji: "🙌", userIds: ["mathea", "adrian", "petter", "ingrid", "nadia"] },
      { emoji: "❤️", userIds: ["mathea", "adrian"] },
    ],
  },
  {
    id: "p-tu-2",
    communityId: "tryggere-ungdom",
    authorId: "mathea",
    kind: "post",
    title: "Tilbake fra skolebesøk på Ullern",
    body:
      "Tre klasser på vg2 i dag. De var stille de første ti minuttene og stilte så spørsmål helt til det ringte ut.\n\nDet som gikk igjen: de vet ikke hva de skal gjøre hvis en venn blir dårlig, og de er redde for å ringe etter hjelp. Det siste er verdt å ta på alvor. Jeg foreslår at vi lager en kort ting om nettopp det til neste besøk.",
    createdAt: "2026-09-04T16:30:00+02:00",
    reactions: [
      { emoji: "👏", userIds: ["hanne", "ingrid", "adrian", "nadia"] },
      { emoji: "💡", userIds: ["petter"] },
    ],
  },
  {
    id: "p-tu-3",
    communityId: "tryggere-ungdom",
    authorId: "emma-mortensen",
    kind: "post",
    body:
      "Filmkvelden i Bergen ble fullere enn vi trodde — sytten stykker i et rom med plass til tolv. Vi fikk låne stoler fra naboen i gangen.\n\nNeste gang booker vi det store rommet. Takk til alle som kom, og til han som tok med hjemmebakt.",
    createdAt: "2026-09-02T21:15:00+02:00",
    reactions: [{ emoji: "🍿", userIds: ["hanne", "mathea", "petter"] }],
  },
  {
    id: "p-tu-4",
    communityId: "tryggere-ungdom",
    authorId: "ingrid",
    kind: "post",
    title: "Hvordan snakker vi med de yngste?",
    body:
      "Vi har mye materiell som fungerer for russ og studenter, men lite som treffer 15–16-åringer. Språket vårt blir enten for teknisk eller for belærende.\n\nEr det noen som har lyst til å sitte en kveld og skrive om et par av tekstene sammen med meg? Jeg tror vi kommer langt på to timer.",
    createdAt: "2026-08-30T18:45:00+02:00",
    reactions: [{ emoji: "🙋", userIds: ["mathea", "adrian"] }],
  },
  {
    id: "p-tu-5",
    communityId: "tryggere-ungdom",
    authorId: "hanne",
    kind: "announcement",
    title: "Vi trenger frivillige til høstsamlingen",
    body:
      "Helgen 17.–18. oktober samler vi lokallagene på Sundvolden. Vi trenger seks personer til praktisk gjennomføring: rigg, mat, registrering og en som holder styr på programmet.\n\nDu får dekket reise og overnatting. Meld deg i #arrangementer innen 1. oktober.",
    createdAt: "2026-08-27T09:30:00+02:00",
    reactions: [{ emoji: "✋", userIds: ["mathea", "adrian", "petter"] }],
  },

  // ── Under The Rug ─────────────────────────────────────────────────────
  {
    id: "p-utr-1",
    communityId: "under-the-rug",
    authorId: "marte",
    kind: "announcement",
    pinned: true,
    title: "Høstprogrammet er klart",
    body:
      "Fire netter mellom september og desember. Vi åpner i lokalet på Kabelgata den 26. september, og avslutter med nyttårsraven i desember.\n\nBillettene legges ut på fredag. Som vanlig holder vi av tjue plasser per kveld til folk som ikke har råd — send en melding til meg, du trenger ikke forklare noe.",
    createdAt: "2026-09-05T17:30:00+02:00",
    reactions: [
      { emoji: "🔥", userIds: ["vilde", "eirik", "oskar", "ingrid", "tobias", "sindre"] },
      { emoji: "❤️", userIds: ["vilde", "oskar"] },
    ],
  },
  {
    id: "p-utr-2",
    communityId: "under-the-rug",
    authorId: "eirik",
    kind: "post",
    body:
      "Riggelisten for Kabelgata er oppdatert. Vi låner to Martin-hoder fra Eirik på Blå, så vi slipper å leie inn i år. Trenger fortsatt to personer til rigg fra klokka 14 på fredagen.",
    createdAt: "2026-09-04T20:11:00+02:00",
    reactions: [{ emoji: "🙋", userIds: ["ingrid", "oskar"] }],
  },
  {
    id: "p-utr-4",
    communityId: "under-the-rug",
    authorId: "vilde",
    kind: "post",
    body:
      "Regnskapet for vårsesongen er ferdig. Vi gikk 18 400 kroner i pluss, som i sin helhet er fordelt til de tolv artistene som spilte. Detaljene ligger i #pagaende-prosjekter for dem som liker regneark.",
    createdAt: "2026-08-27T10:20:00+02:00",
    reactions: [{ emoji: "👏", userIds: ["marte", "eirik", "oskar", "ingrid"] }],
  },
  {
    id: "p-utr-5",
    communityId: "under-the-rug",
    authorId: "sindre",
    kind: "post",
    title: "Nytt subbass-oppsett før høsten",
    body:
      "Vi har bygget om de to bunnkassene og byttet delefilteret. Forskjellen er tydelig under 40 Hz, og vi slipper klippingen vi hadde i mai.\n\nJeg vil gjerne teste det med publikum i rommet før 26. Er det noen som kan stille en kveld i uke 38?",
    createdAt: "2026-08-31T19:05:00+02:00",
    reactions: [{ emoji: "🔊", userIds: ["eirik", "jonas", "tobias"] }],
  },
];
