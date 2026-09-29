import type { Comment } from "@/lib/types";

/**
 * Comments and replies.
 *
 * `posts.comment_count` used to be a seeded number with nothing behind it.
 * These are the rows it is now counted from, so the number on screen is the
 * number of things a person can actually read.
 *
 * A reply carries `parentId` and must sit on the same post as its parent; the
 * database enforces both, and `scripts/check-content.ts` catches a mistake here
 * before it ever reaches a seed.
 */
export const comments: Comment[] = [
  // ── Tryggere Ruspolitikk ─────────────────────────────────────────────
  {
    id: "c-tr-1",
    postId: "p-tr-1",
    authorId: "elise",
    body: "Kapittel fire ble mye bedre etter omskrivingen. Det var verdt søndagen.",
    createdAt: "2026-09-05T09:12:00+02:00",
  },
  {
    id: "c-tr-2",
    postId: "p-tr-1",
    authorId: "ingrid",
    parentId: "c-tr-1",
    body: "Takk igjen for at du tok den. Jeg skylder deg kaffe.",
    createdAt: "2026-09-05T09:40:00+02:00",
  },
  {
    id: "c-tr-3",
    postId: "p-tr-1",
    authorId: "linn",
    body: "Er det mulig å få en kortversjon på to sider? Jeg skal presentere dette for kommunen i november, og de leser ikke seksti.",
    createdAt: "2026-09-05T11:02:00+02:00",
  },
  {
    id: "c-tr-4",
    postId: "p-tr-1",
    authorId: "amina",
    parentId: "c-tr-3",
    body: "Ja. Jeg lager en oppsummering på to sider i løpet av neste uke og legger den i samme mappe.",
    createdAt: "2026-09-05T11:35:00+02:00",
  },
  {
    id: "c-tr-5",
    postId: "p-tr-2",
    authorId: "amina",
    body: "Det spørsmålet kommer hver gang. Vi bør ha et skriftlig svar vi kan stå for, ikke bare improvisere i møter.",
    createdAt: "2026-09-04T16:20:00+02:00",
  },
  {
    id: "c-tr-6",
    postId: "p-tr-2",
    authorId: "kristoffer",
    body: "Jeg hører det samme i standen. Folk er ikke imot reform, de er redde for at ungdom skal tro at alt er greit.",
    createdAt: "2026-09-04T18:05:00+02:00",
  },
  {
    id: "c-tr-7",
    postId: "p-tr-3",
    authorId: "petter",
    body: "Jeg tar en vakt i Trondheim. Sett meg opp på lørdagen.",
    createdAt: "2026-09-02T12:15:00+02:00",
  },
  {
    id: "c-tr-8",
    postId: "p-tr-3",
    authorId: "kristoffer",
    body: "Husk å ta med regnjakke til Bergen. Erfaringsbasert råd.",
    createdAt: "2026-09-02T14:48:00+02:00",
  },
  {
    id: "c-tr-9",
    postId: "p-tr-4",
    authorId: "nadia",
    body: "Halvannet år. Det sier litt om hvor lang tid slikt tar, og hvor mye det betyr at noen holder ut.",
    createdAt: "2026-08-29T10:30:00+02:00",
  },
  {
    id: "c-tr-10",
    postId: "p-tr-4",
    authorId: "ingrid",
    body: "Gratulerer. Si fra hvis dere vil ha noen med på møtet — jeg kan komme opp.",
    createdAt: "2026-08-29T12:11:00+02:00",
  },
  {
    id: "c-tr-11",
    postId: "p-tr-5",
    authorId: "elise",
    body: "Er det mulig å delta digitalt på hele møtet, også under valget?",
    createdAt: "2026-08-26T14:20:00+02:00",
  },
  {
    id: "c-tr-12",
    postId: "p-tr-5",
    authorId: "amina",
    parentId: "c-tr-11",
    body: "Ja. Vi bruker samme opplegg som i fjor, med skriftlig avstemning for dem som er med på skjerm.",
    createdAt: "2026-08-26T15:02:00+02:00",
  },

  // ── Tryggere Ungdom ──────────────────────────────────────────────────
  {
    id: "c-tu-1",
    postId: "p-tu-1",
    authorId: "adrian",
    body: "Kommer på alle fire i Oslo hvis jeg får fri fra jobb. Blir det opptak av noe?",
    createdAt: "2026-09-05T15:02:00+02:00",
  },
  {
    id: "c-tu-2",
    postId: "p-tu-1",
    authorId: "hanne",
    parentId: "c-tu-1",
    body: "Ikke av kursene — folk snakker friere når det ikke tas opp. Men vi lager et notat etterpå.",
    createdAt: "2026-09-05T15:30:00+02:00",
  },
  {
    id: "c-tu-3",
    postId: "p-tu-1",
    authorId: "mathea",
    body: "Til alle som lurer: det er helt greit å sitte bakerst og bare høre på første gangen. Ingen blir pekt på.",
    createdAt: "2026-09-05T16:44:00+02:00",
  },
  {
    id: "c-tu-4",
    postId: "p-tu-2",
    authorId: "hanne",
    body: "Dette er viktig. Frykten for å ringe er noe vi kan gjøre noe med på en ettermiddag.",
    createdAt: "2026-09-04T17:10:00+02:00",
  },
  {
    id: "c-tu-5",
    postId: "p-tu-2",
    authorId: "petter",
    body: "Jeg kan skrive et utkast til en kort tekst om akkurat det. Én side, store bokstaver, ingen jus.",
    createdAt: "2026-09-04T19:25:00+02:00",
  },
  {
    id: "c-tu-6",
    postId: "p-tu-2",
    authorId: "nadia",
    parentId: "c-tu-5",
    body: "Send den til meg før den går ut. Jeg har hørt denne samtalen tusen ganger og vet hvor folk stopper.",
    createdAt: "2026-09-04T20:02:00+02:00",
  },
  {
    id: "c-tu-7",
    postId: "p-tu-3",
    authorId: "mathea",
    body: "Sytten på en filmkveld i Bergen er sterkt. Godt jobbet.",
    createdAt: "2026-09-02T22:05:00+02:00",
  },
  {
    id: "c-tu-8",
    postId: "p-tu-3",
    authorId: "hanne",
    body: "Book det store rommet for resten av høsten med en gang, før noen andre gjør det.",
    createdAt: "2026-09-03T08:14:00+02:00",
  },
  {
    id: "c-tu-9",
    postId: "p-tu-4",
    authorId: "mathea",
    body: "Jeg blir med. Torsdag kveld passer meg.",
    createdAt: "2026-08-30T19:30:00+02:00",
  },
  {
    id: "c-tu-10",
    postId: "p-tu-4",
    authorId: "adrian",
    body: "Jeg er ikke god til å skrive, men jeg kan si fra når noe høres teit ut. Det er kanskje like nyttig.",
    createdAt: "2026-08-30T21:12:00+02:00",
  },
  {
    id: "c-tu-11",
    postId: "p-tu-4",
    authorId: "ingrid",
    parentId: "c-tu-10",
    body: "Det er faktisk den nyttigste rollen i rommet. Bli med.",
    createdAt: "2026-08-31T07:55:00+02:00",
  },
  {
    id: "c-tu-12",
    postId: "p-tu-5",
    authorId: "petter",
    body: "Meldt meg på registrering. Trenger vi en liste over hvem som kommer på forhånd?",
    createdAt: "2026-08-27T10:40:00+02:00",
  },
  {
    id: "c-tu-13",
    postId: "p-tu-5",
    authorId: "adrian",
    body: "Jeg kjører fra Bergen og har tre ledige plasser i bilen.",
    createdAt: "2026-08-27T12:20:00+02:00",
  },

  // ── Under The Rug ────────────────────────────────────────────────────
  {
    id: "c-utr-1",
    postId: "p-utr-1",
    authorId: "oskar",
    body: "Jeg tar plakatene for alle fire kveldene. Trenger navn og tider innen fredag for å rekke trykk.",
    createdAt: "2026-09-05T18:10:00+02:00",
  },
  {
    id: "c-utr-2",
    postId: "p-utr-1",
    authorId: "marte",
    parentId: "c-utr-1",
    body: "Får dem til deg i morgen tidlig. Alt er bekreftet bortsett fra én artist i desember.",
    createdAt: "2026-09-05T18:35:00+02:00",
  },
  {
    id: "c-utr-3",
    postId: "p-utr-1",
    authorId: "jonas",
    body: "De tjue plassene er den beste tingen dere gjør. Bare så det er sagt.",
    createdAt: "2026-09-05T20:02:00+02:00",
  },
  {
    id: "c-utr-4",
    postId: "p-utr-2",
    authorId: "ingrid",
    body: "Jeg stiller på rigg. Har bil hvis vi må hente noe fra Blå.",
    createdAt: "2026-09-04T20:50:00+02:00",
  },
  {
    id: "c-utr-5",
    postId: "p-utr-2",
    authorId: "sindre",
    body: "Husk at de hodene trekker mye strøm. Vi må fordele kursene bedre enn sist.",
    createdAt: "2026-09-05T07:40:00+02:00",
  },
  {
    id: "c-utr-9",
    postId: "p-utr-4",
    authorId: "eirik",
    body: "Alt til artistene. Det er derfor jeg gidder å bære høyttalere i trapper.",
    createdAt: "2026-08-27T11:40:00+02:00",
  },
  {
    id: "c-utr-10",
    postId: "p-utr-5",
    authorId: "jonas",
    body: "Jeg kan komme ned i uke 38 og høre. Har et par plater som avslører alt som er galt under 40.",
    createdAt: "2026-08-31T20:15:00+02:00",
  },
  {
    id: "c-utr-11",
    postId: "p-utr-5",
    authorId: "eirik",
    parentId: "c-utr-10",
    body: "Perfekt. Onsdag eller torsdag, si fra hva som passer.",
    createdAt: "2026-08-31T21:02:00+02:00",
  },
];
