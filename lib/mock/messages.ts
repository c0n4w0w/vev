import type { Message } from "@/lib/types";

/**
 * A fixture message. Its reactions name who gave them, so the seed can write
 * one reaction row per person; the app itself only ever sees counts.
 */
export type FixtureMessage = Omit<Message, "reactions"> & {
  reactions?: { emoji: string; userIds: string[] }[];
};

/** Channel ids follow the `${communityId}--${channelName}` convention. */
export const messages: FixtureMessage[] = [
  // ── Tryggere Ruspolitikk / #generelt ─────────────────────────────────
  {
    id: "m-1",
    channelId: "tryggere-ruspolitikk--generelt",
    authorId: "kristoffer",
    body: "God morgen. Er det noen som vet om vi har flere av de nye brosjyrene på lageret på Grünerløkka?",
    createdAt: "2026-09-06T08:42:00+02:00",
  },
  {
    id: "m-2",
    channelId: "tryggere-ruspolitikk--generelt",
    authorId: "ingrid",
    body: "Ja, det står fire esker igjen. Jeg var innom på torsdag. Nøkkelen henger fortsatt bak sikringsskapet.",
    createdAt: "2026-09-06T08:51:00+02:00",
    reactions: [{ emoji: "🙏", userIds: ["kristoffer"] }],
  },
  {
    id: "m-3",
    channelId: "tryggere-ruspolitikk--generelt",
    authorId: "kristoffer",
    body: "Perfekt, takk. Da tar jeg med to esker til Bergen på fredag.",
    createdAt: "2026-09-06T08:55:00+02:00",
  },
  {
    id: "m-4",
    channelId: "tryggere-ruspolitikk--generelt",
    authorId: "linn",
    body: "Litt utenfor tema, men: har noen lest den nye rapporten fra FHI om overdosetall? Tallene for 2025 kom i går.",
    createdAt: "2026-09-06T10:12:00+02:00",
  },
  {
    id: "m-5",
    channelId: "tryggere-ruspolitikk--generelt",
    authorId: "amina",
    body: "Har lest den. Kort versjon: nedgang i Oslo, oppgang i de mellomstore byene. Det er ikke det bildet noen forventet.\n\nJeg legger sammendraget i #pagaende-prosjekter i ettermiddag.",
    createdAt: "2026-09-06T10:31:00+02:00",
    reactions: [{ emoji: "👀", userIds: ["linn", "ingrid", "nadia"] }],
    attachment: { kind: "file", label: "FHI-overdosetall-2025.pdf", meta: "PDF · 2,4 MB" },
  },
  {
    id: "m-6",
    channelId: "tryggere-ruspolitikk--generelt",
    authorId: "nadia",
    body: "Det stemmer med det vi hører fra Drammen. Vi har hatt tre henvendelser denne måneden fra folk som ikke visste at det finnes et tilbud i det hele tatt.",
    createdAt: "2026-09-06T10:58:00+02:00",
  },
  {
    id: "m-7",
    channelId: "tryggere-ruspolitikk--generelt",
    authorId: "petter",
    body: "Kan vi ta det opp på neste lokallagsmøte? Jeg tror Trondheim har samme problem.",
    createdAt: "2026-09-06T11:14:00+02:00",
    reactions: [{ emoji: "👍", userIds: ["nadia", "amina"] }],
  },

  // ── Tryggere Ruspolitikk / #kunngjoringer ────────────────────────────
  {
    id: "m-10",
    channelId: "tryggere-ruspolitikk--kunngjoringer",
    authorId: "amina",
    body: "Høringssvaret er levert. Hele dokumentet ligger i #pagaende-prosjekter, og oppsummeringen er publisert på nettsidene våre.",
    createdAt: "2026-09-05T08:22:00+02:00",
    reactions: [{ emoji: "👏", userIds: ["ingrid", "nadia", "kristoffer", "linn", "petter"] }],
  },
  {
    id: "m-11",
    channelId: "tryggere-ruspolitikk--kunngjoringer",
    authorId: "ingrid",
    body: "Påminnelse: frist for å melde saker til årsmøtet er 17. oktober. Send til styret@tryggereruspolitikk.no.",
    createdAt: "2026-09-01T09:00:00+02:00",
  },

  // ── Tryggere Ruspolitikk / #presentasjoner ───────────────────────────
  {
    id: "m-14",
    channelId: "tryggere-ruspolitikk--presentasjoner",
    authorId: "petter",
    body: "Hei alle sammen. Petter, 24, studerer statsvitenskap i Trondheim. Ble med etter å ha stått i standen på Studentersamfundet i fjor. Jeg kan bidra med research og skriving.",
    createdAt: "2026-08-24T19:22:00+02:00",
    reactions: [{ emoji: "👋", userIds: ["amina", "ingrid", "linn", "nadia"] }],
  },
  {
    id: "m-15",
    channelId: "tryggere-ruspolitikk--presentasjoner",
    authorId: "elise",
    body: "Hei. Elise, jurist i Oslo. Jeg jobber med forvaltningsrett til daglig og bidrar med gjennomlesing av høringssvar på fritiden. Har begrenset kapasitet i november, men ellers ganske fleksibel.",
    createdAt: "2026-08-19T21:05:00+02:00",
    reactions: [{ emoji: "👋", userIds: ["amina", "ingrid"] }],
  },

  // ── Tryggere Ruspolitikk / #arrangementer ────────────────────────────
  {
    id: "m-18",
    channelId: "tryggere-ruspolitikk--arrangementer",
    authorId: "ingrid",
    body: "Vaktlisten for Bergen 19. september er lagt ut. Vi mangler fire personer på lørdagsvakten, 12–16.",
    createdAt: "2026-09-02T11:08:00+02:00",
    attachment: { kind: "link", label: "Vaktliste — september 2026", meta: "Delt dokument" },
  },
  {
    id: "m-19",
    channelId: "tryggere-ruspolitikk--arrangementer",
    authorId: "kristoffer",
    body: "Jeg tar 12–14.",
    createdAt: "2026-09-02T11:31:00+02:00",
    reactions: [{ emoji: "🙏", userIds: ["ingrid"] }],
  },
  {
    id: "m-20",
    channelId: "tryggere-ruspolitikk--arrangementer",
    authorId: "petter",
    body: "Kan ta 14–16 hvis ingen andre melder seg innen onsdag. Har en forelesning jeg kanskje kan flytte.",
    createdAt: "2026-09-02T12:47:00+02:00",
  },

  // ── Tryggere Ruspolitikk / #pagaende-prosjekter ──────────────────────
  {
    id: "m-23",
    channelId: "tryggere-ruspolitikk--pagaende-prosjekter",
    authorId: "amina",
    body: "Status på de tre løpende sakene:\n\n1. Høringssvar rusreform — levert 4. september.\n2. Lavterskeltilbud Tromsø — møte med kommunen i november.\n3. Fagdag for helsepersonell — mangler fortsatt lokale.",
    createdAt: "2026-09-05T16:00:00+02:00",
    reactions: [{ emoji: "📌", userIds: ["ingrid", "nadia"] }],
  },
  {
    id: "m-24",
    channelId: "tryggere-ruspolitikk--pagaende-prosjekter",
    authorId: "ingrid",
    body: "Jeg hører med Litteraturhuset om fagdagen. De hadde ledig i uke 45 sist jeg sjekket.",
    createdAt: "2026-09-05T16:19:00+02:00",
  },

  // ── Tryggere Ruspolitikk / #samarbeid ────────────────────────────────
  {
    id: "m-27",
    channelId: "tryggere-ruspolitikk--samarbeid",
    authorId: "nadia",
    body: "Fikk en henvendelse fra Gatejuristen om felles seminar til våren. De foreslår mars. Jeg synes vi bør si ja.",
    createdAt: "2026-09-03T13:24:00+02:00",
    reactions: [{ emoji: "👍", userIds: ["amina", "ingrid", "elise"] }],
  },
  {
    id: "m-28",
    channelId: "tryggere-ruspolitikk--samarbeid",
    authorId: "amina",
    body: "Enig. Ta det med i neste styremøte, så formaliserer vi det der.",
    createdAt: "2026-09-03T13:40:00+02:00",
  },

  // ── Tryggere Ungdom / #generelt ──────────────────────────────────────
  {
    id: "m-31",
    channelId: "tryggere-ungdom--generelt",
    authorId: "adrian",
    body: "Er det noen som har prosjektoren fra filmkvelden? Den sto ikke i skapet da jeg lette i går.",
    createdAt: "2026-09-06T09:20:00+02:00",
  },
  {
    id: "m-32",
    channelId: "tryggere-ungdom--generelt",
    authorId: "mathea",
    body: "Den står hos meg. Jeg tok den med hjem for å bytte lampen. Leverer den tilbake på torsdag.",
    createdAt: "2026-09-06T09:38:00+02:00",
    reactions: [{ emoji: "🙏", userIds: ["adrian"] }],
  },
  {
    id: "m-33",
    channelId: "tryggere-ungdom--generelt",
    authorId: "hanne",
    body: "Mens dere er her: har noen forslag til hva vi skal gjøre på samlingen i oktober utenom det faglige? I fjor ble det for mye stillesitting.",
    createdAt: "2026-09-06T10:44:00+02:00",
  },
  {
    id: "m-34",
    channelId: "tryggere-ungdom--generelt",
    authorId: "petter",
    body: "Noe fysisk. Klatring, eller bare en lang tur hvis været holder. Det er lettere å bli kjent når man går ved siden av hverandre enn når man sitter i ring.",
    createdAt: "2026-09-06T11:02:00+02:00",
    reactions: [{ emoji: "👍", userIds: ["hanne", "mathea", "adrian"] }],
  },
  {
    id: "m-35",
    channelId: "tryggere-ungdom--generelt",
    authorId: "ingrid",
    body: "Vi har et telt og tolv liggeunderlag på lageret hvis dere vil ha noe utendørs. Bare si fra i god tid, så henter jeg det.",
    createdAt: "2026-09-06T11:26:00+02:00",
  },

  // ── Tryggere Ungdom / #kunngjoringer ─────────────────────────────────
  {
    id: "m-37",
    channelId: "tryggere-ungdom--kunngjoringer",
    authorId: "hanne",
    body: "Høstens kursrekke er publisert. Påmelding åpner på mandag, og alle kursene er gratis.",
    createdAt: "2026-09-05T14:12:00+02:00",
    reactions: [{ emoji: "🙌", userIds: ["mathea", "adrian", "petter", "nadia"] }],
  },
  {
    id: "m-38",
    channelId: "tryggere-ungdom--kunngjoringer",
    authorId: "mathea",
    body: "Frist for å melde seg som frivillig til høstsamlingen er 1. oktober. Skriv i #arrangementer.",
    createdAt: "2026-08-27T09:35:00+02:00",
  },

  // ── Tryggere Ungdom / #presentasjoner ────────────────────────────────
  {
    id: "m-40",
    channelId: "tryggere-ungdom--presentasjoner",
    authorId: "adrian",
    body: "Hei. Adrian, 19, fra Bergen. Lærling som elektriker. Kom med etter et kurs dere holdt på skolen i fjor, og har blitt hengende igjen siden. Kan hjelpe med alt som har med strøm og rigg å gjøre.",
    createdAt: "2026-08-22T17:40:00+02:00",
    reactions: [{ emoji: "👋", userIds: ["hanne", "mathea", "petter"] }],
  },
  {
    id: "m-41",
    channelId: "tryggere-ungdom--presentasjoner",
    authorId: "mathea",
    body: "Mathea, 22, Oslo. Studerer sosialt arbeid. Har vært frivillig her siden jeg gikk på videregående, og har ansvar for aktivitetene nå. Spør meg om hva som helst — jeg husker godt hvor rart det var å komme første gang.",
    createdAt: "2026-07-30T20:15:00+02:00",
    reactions: [{ emoji: "👋", userIds: ["hanne", "adrian"] }],
  },

  // ── Tryggere Ungdom / #arrangementer ─────────────────────────────────
  {
    id: "m-43",
    channelId: "tryggere-ungdom--arrangementer",
    authorId: "mathea",
    body: "Høstsamlingen på Sundvolden 17.–18. oktober. Vi trenger seks frivillige til rigg, mat og registrering. Reise og overnatting dekkes.",
    createdAt: "2026-08-27T09:40:00+02:00",
    attachment: { kind: "link", label: "Program høstsamlingen 2026", meta: "Delt dokument" },
  },
  {
    id: "m-44",
    channelId: "tryggere-ungdom--arrangementer",
    authorId: "adrian",
    body: "Jeg stiller. Kan ta rigg, og kjøre hvis vi trenger en bil fra Bergen.",
    createdAt: "2026-08-27T12:05:00+02:00",
    reactions: [{ emoji: "🙌", userIds: ["mathea", "hanne"] }],
  },
  {
    id: "m-45",
    channelId: "tryggere-ungdom--arrangementer",
    authorId: "petter",
    body: "Jeg tar registrering. Har gjort det før og vet hvor det pleier å gå galt.",
    createdAt: "2026-08-28T08:50:00+02:00",
  },

  // ── Tryggere Ungdom / #pagaende-prosjekter ───────────────────────────
  {
    id: "m-48",
    channelId: "tryggere-ungdom--pagaende-prosjekter",
    authorId: "petter",
    body: "Jeg har begynt på omskrivingen av materiellet for 15–16-åringer. Første utkast på to av tekstene ligger i mappa.\n\nHovedgrepet er å kutte alt som høres ut som en brosjyre og skrive som om vi snakker med én person.",
    createdAt: "2026-09-04T20:30:00+02:00",
    attachment: { kind: "file", label: "materiell-ungdom-utkast.docx", meta: "Dokument · 62 KB" },
    reactions: [{ emoji: "👀", userIds: ["hanne", "mathea"] }],
  },
  {
    id: "m-49",
    channelId: "tryggere-ungdom--pagaende-prosjekter",
    authorId: "hanne",
    body: "Leste gjennom i morges. Dette er mye bedre. Jeg har lagt inn noen kommentarer på den andre teksten, ellers er den klar til testing på et skolebesøk.",
    createdAt: "2026-09-05T08:15:00+02:00",
    reactions: [{ emoji: "🙏", userIds: ["petter"] }],
  },

  // ── Tryggere Ungdom / #samarbeid ─────────────────────────────────────
  {
    id: "m-51",
    channelId: "tryggere-ungdom--samarbeid",
    authorId: "hanne",
    body: "Elevrådet på tre skoler i Bergen har spurt om vi kan komme fast én gang i semesteret. Det er mer enn vi klarer med dagens bemanning, men jeg vil gjerne si ja til to av dem.",
    createdAt: "2026-09-03T15:10:00+02:00",
    reactions: [{ emoji: "👍", userIds: ["mathea", "adrian"] }],
  },
  {
    id: "m-52",
    channelId: "tryggere-ungdom--samarbeid",
    authorId: "ingrid",
    body: "Moderorganisasjonen kan stille med en fagperson på ett av besøkene hvis det hjelper. Si fra hvilken dato, så finner jeg noen.",
    createdAt: "2026-09-03T15:44:00+02:00",
  },

  // ── Under The Rug / #generelt ────────────────────────────────────────
  {
    id: "m-54",
    channelId: "under-the-rug--generelt",
    authorId: "vilde",
    body: "Er det noen som har nøkkelen til lageret i Kabelgata? Jeg finner ikke min.",
    createdAt: "2026-09-06T09:33:00+02:00",
  },
  {
    id: "m-55",
    channelId: "under-the-rug--generelt",
    authorId: "eirik",
    body: "Jeg har den. La den igjen i lomma etter rigg forrige helg. Leverer den tilbake i morgen.",
    createdAt: "2026-09-06T09:47:00+02:00",
    reactions: [{ emoji: "😄", userIds: ["vilde", "marte"] }],
  },
  {
    id: "m-56",
    channelId: "under-the-rug--generelt",
    authorId: "sindre",
    body: "Noen som har en ledig DI-boks jeg kan låne til torsdag? Min ga opp midt i soundcheck i går.",
    createdAt: "2026-09-06T12:04:00+02:00",
  },
  {
    id: "m-57",
    channelId: "under-the-rug--generelt",
    authorId: "jonas",
    body: "Jeg har to i Bergen, men det hjelper deg lite på torsdag. Eirik har vel en?",
    createdAt: "2026-09-06T12:19:00+02:00",
  },
  {
    id: "m-58",
    channelId: "under-the-rug--generelt",
    authorId: "eirik",
    body: "Har en Radial. Kan legge den i lokalet i morgen tidlig.",
    createdAt: "2026-09-06T12:41:00+02:00",
    reactions: [{ emoji: "🙏", userIds: ["sindre"] }],
  },
  // Jonas's studio note and its replies were a feed post before the feed
  // became staff-only. It is member conversation, so it lives here now.
  {
    id: "m-76",
    channelId: "under-the-rug--generelt",
    authorId: "jonas",
    body: "Sitter i studio i Bergen denne uka og jobber med noe som begynner å likne et live-sett. Hvis noen har lyst til å høre på en halvferdig skisse og være ærlig, si fra.",
    createdAt: "2026-08-28T21:03:00+02:00",
    reactions: [{ emoji: "👂", userIds: ["sindre", "tobias", "marte"] }],
  },
  {
    id: "m-77",
    channelId: "under-the-rug--generelt",
    authorId: "sindre",
    body: "Send den. Jeg lover å være ærlig, og det er ikke alltid hyggelig.",
    createdAt: "2026-08-28T21:40:00+02:00",
  },
  {
    id: "m-78",
    channelId: "under-the-rug--generelt",
    authorId: "tobias",
    body: "Samme her. Send den i to versjoner hvis du er i tvil om noe.",
    createdAt: "2026-08-29T09:10:00+02:00",
  },

  // ── Under The Rug / #kunngjoringer ───────────────────────────────────
  {
    id: "m-60",
    channelId: "under-the-rug--kunngjoringer",
    authorId: "marte",
    body: "Høstprogrammet er publisert. Billetter legges ut fredag klokka 10.",
    createdAt: "2026-09-05T17:32:00+02:00",
    reactions: [{ emoji: "🔥", userIds: ["vilde", "eirik", "oskar", "ingrid", "sindre"] }],
  },

  // ── Under The Rug / #presentasjoner ──────────────────────────────────
  {
    id: "m-63",
    channelId: "under-the-rug--presentasjoner",
    authorId: "oskar",
    body: "Oskar, grafisk designer. Har laget plakater for kollektivet siden 2024. Sitter mest med trykk, men kan hjelpe med skjerm også.",
    createdAt: "2026-07-14T15:11:00+02:00",
    reactions: [{ emoji: "👋", userIds: ["marte", "vilde", "eirik"] }],
  },
  {
    id: "m-64",
    channelId: "under-the-rug--presentasjoner",
    authorId: "jonas",
    body: "Jonas, produsent og mastering-ingeniør fra Bergen. Kom inn via Tobias i fjor høst. Jobber mest med maskinvare, og sier gjerne ja til å mastre ting for folk her.",
    createdAt: "2025-09-02T17:40:00+02:00",
    reactions: [{ emoji: "👋", userIds: ["marte", "sindre", "tobias"] }],
  },

  // ── Under The Rug / #arrangementer ───────────────────────────────────
  {
    id: "m-66",
    channelId: "under-the-rug--arrangementer",
    authorId: "eirik",
    body: "Rigg på Kabelgata starter fredag 25. klokka 14. Vi trenger to til. Det tar rundt fire timer, og det er pizza.",
    createdAt: "2026-09-04T20:14:00+02:00",
  },
  {
    id: "m-67",
    channelId: "under-the-rug--arrangementer",
    authorId: "ingrid",
    body: "Jeg stiller. Kan ta med bilen hvis vi trenger å hente noe.",
    createdAt: "2026-09-04T20:29:00+02:00",
    reactions: [{ emoji: "🙌", userIds: ["eirik", "vilde"] }],
  },
  {
    id: "m-68",
    channelId: "under-the-rug--arrangementer",
    authorId: "oskar",
    body: "Jeg også, men jeg kan først fra 15.30.",
    createdAt: "2026-09-05T08:05:00+02:00",
  },
  {
    id: "m-69",
    channelId: "under-the-rug--arrangementer",
    authorId: "tobias",
    body: "Nattraven i november er bekreftet. Tre live-sett og to DJ-er, og vi holder på til fem.",
    createdAt: "2026-09-03T09:55:00+02:00",
    reactions: [{ emoji: "🙌", userIds: ["marte", "sindre", "eirik", "jonas"] }],
  },

  // ── Under The Rug / #pagaende-prosjekter ─────────────────────────────
  {
    id: "m-71",
    channelId: "under-the-rug--pagaende-prosjekter",
    authorId: "vilde",
    body: "Regnskapet for våren ligger nå i mappa. 18 400 kroner fordelt på tolv artister, utbetalt 26. august.",
    createdAt: "2026-08-27T10:22:00+02:00",
    attachment: { kind: "file", label: "regnskap-var-2026.xlsx", meta: "Regneark · 84 KB" },
  },
  {
    id: "m-72",
    channelId: "under-the-rug--pagaende-prosjekter",
    authorId: "sindre",
    body: "Oppdatert teknisk rider ligger i mappa. Viktigste endring er kravet om separat strømkurs til modulærsystemet.",
    createdAt: "2026-09-03T14:08:00+02:00",
    attachment: { kind: "file", label: "utr-rider-host-2026.pdf", meta: "PDF · 310 KB" },
  },
  // Oskar's poster drafts, formerly a feed post with comments. Work in
  // progress between members belongs in the project channel.
  {
    id: "m-79",
    channelId: "under-the-rug--pagaende-prosjekter",
    authorId: "oskar",
    body: "Plakatutkast til september: la tre utkast i mappa. Jeg lener mot det andre — mindre tekst, større flate, og det fungerer bedre i A3 enn på skjerm. Si fra hvis noe skurrer med lesbarheten, jeg har stirret på det for lenge.",
    createdAt: "2026-09-01T22:47:00+02:00",
    reactions: [{ emoji: "👀", userIds: ["marte", "vilde"] }],
  },
  {
    id: "m-80",
    channelId: "under-the-rug--pagaende-prosjekter",
    authorId: "vilde",
    body: "Nummer to, klart. Den første er penere på skjerm, men den andre overlever å bli hengt opp på en vegg i regnet.",
    createdAt: "2026-09-02T08:15:00+02:00",
  },
  {
    id: "m-81",
    channelId: "under-the-rug--pagaende-prosjekter",
    authorId: "marte",
    body: "Enig i nummer to. Kan vi få datoen litt større?",
    createdAt: "2026-09-02T09:30:00+02:00",
  },
  {
    id: "m-82",
    channelId: "under-the-rug--pagaende-prosjekter",
    authorId: "oskar",
    body: "Ja. Jeg øker den to punkter og flytter den over logoen.",
    createdAt: "2026-09-02T10:05:00+02:00",
  },

  // ── Under The Rug / #samarbeid ───────────────────────────────────────
  {
    id: "m-74",
    channelId: "under-the-rug--samarbeid",
    authorId: "marte",
    body: "Kabelgata har spurt om vi vil dele lokale med et annet kollektiv for en kveld i november. Jeg tenker ja — vi deler rigg og de tar med sitt eget lydanlegg.",
    createdAt: "2026-09-02T18:50:00+02:00",
    reactions: [{ emoji: "👍", userIds: ["vilde", "eirik", "tobias"] }],
  },
  {
    id: "m-75",
    channelId: "under-the-rug--samarbeid",
    authorId: "tobias",
    body: "Bra. Da slipper vi å leie inn ekstra bass, og de har en teknikker som kan rigge sammen med Sindre.",
    createdAt: "2026-09-02T19:22:00+02:00",
  },
];
