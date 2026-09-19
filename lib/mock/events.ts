import type { CommunityEvent } from "@/lib/types";

export type SeedEvent = CommunityEvent & {
  /** Human-readable fixture key; the seed resolves it to events.local_group_id. */
  localGroupName?: string;
};

/** `isPublic` events are the only ones that appear on a community's portal. */
export const events: SeedEvent[] = [
  // ── Tryggere Ruspolitikk ──────────────────────────────────────────────
  {
    id: "e-tr-local-1",
    communityId: "tryggere-ruspolitikk",
    localGroupName: "FTR Trøndelag",
    title: "Medlemsmøte i Trondheim",
    description:
      "Lokalt medlemsmøte om høstens standvakter og møtet med kommunen. Nye medlemmer er særlig velkommen.",
    startsAt: "2026-09-24T18:00:00+02:00",
    endsAt: "2026-09-24T20:00:00+02:00",
    location: "Trondheim frivilligsentral",
    isPublic: false,
    hostId: "demo-tryggere",
    attendeeIds: ["demo-tryggere", "petter"],
    capacity: 24,
  },
  {
    id: "e-tr-1",
    communityId: "tryggere-ruspolitikk",
    title: "Standvakt — Bergen sentrum",
    description:
      "Vi står med informasjonsmateriell på Torgallmenningen. Du får en halvtimes gjennomgang før vakten, og står alltid sammen med noen erfarne.",
    startsAt: "2026-09-19T12:00:00+02:00",
    endsAt: "2026-09-19T16:00:00+02:00",
    location: "Torgallmenningen, Bergen",
    isPublic: false,
    hostId: "ingrid",
    attendeeIds: ["ingrid", "kristoffer"],
    capacity: 6,
  },
  {
    id: "e-tr-2",
    communityId: "tryggere-ruspolitikk",
    title: "Åpent møte: Hva skjer med rusreformen nå?",
    description:
      "Vi går gjennom høringssvaret vårt og hva som skjer videre i Stortinget. Åpent for alle, ingen påmelding.",
    startsAt: "2026-09-30T18:00:00+02:00",
    endsAt: "2026-09-30T20:00:00+02:00",
    location: "Litteraturhuset, Oslo",
    isPublic: true,
    hostId: "amina",
    attendeeIds: ["amina", "nadia", "ingrid", "elise", "kristoffer"],
    capacity: 120,
  },
  {
    id: "e-tr-3",
    communityId: "tryggere-ruspolitikk",
    title: "Fagdag for helsepersonell",
    description:
      "En dag om skadereduksjon i møte med pasienter. Program kommer. Lokale er ikke endelig bekreftet.",
    startsAt: "2026-11-05T09:00:00+01:00",
    endsAt: "2026-11-05T16:00:00+01:00",
    location: "Oslo — lokale bekreftes",
    isPublic: true,
    hostId: "amina",
    attendeeIds: ["amina", "linn", "nadia"],
    capacity: 90,
  },
  {
    id: "e-tr-4",
    communityId: "tryggere-ruspolitikk",
    title: "Årsmøte 2026",
    description:
      "Ordinært årsmøte med valg, årsberetning og behandling av innmeldte saker. Digital deltakelse er mulig. Frist for å melde saker er 17. oktober.",
    startsAt: "2026-11-14T11:00:00+01:00",
    endsAt: "2026-11-14T16:00:00+01:00",
    location: "Litteraturhuset, Oslo (og digitalt)",
    isPublic: false,
    hostId: "amina",
    attendeeIds: ["amina", "ingrid", "nadia", "linn", "petter", "elise", "kristoffer"],
  },
  {
    id: "e-tr-5",
    communityId: "tryggere-ruspolitikk",
    title: "Lokallagsmøte Tromsø",
    description:
      "Kort møte om lavterskeltilbudet og forberedelser til kommunemøtet i november.",
    startsAt: "2026-09-23T17:30:00+02:00",
    endsAt: "2026-09-23T19:00:00+02:00",
    location: "Tromsø bibliotek",
    isPublic: false,
    hostId: "linn",
    attendeeIds: ["linn", "petter"],
  },

  // ── Tryggere Ungdom ───────────────────────────────────────────────────
  {
    id: "e-tu-1",
    communityId: "tryggere-ungdom",
    title: "Cannabisreform – hvorfor venter Norge?",
    description:
      "Sandefjord – hold av datoen 10. september! Vi har med oss SU-leder Sara og gruppeleder for Sandefjord Venstre, Camilla, for å diskutere hvorfor Norge trenger en ny cannabispolitikk. Spre ordet og ta med en venn – gratis og åpent for alle.",
    startsAt: "2026-09-10T17:00:00+02:00",
    endsAt: "2026-09-10T19:00:00+02:00",
    location: "Aktivitetshuset K1, Sandefjord",
    isPublic: true,
    hostId: "mathea",
    attendeeIds: ["mathea", "hanne", "petter", "adrian"],
    capacity: 30,
  },
  {
    id: "e-tu-2",
    communityId: "tryggere-ungdom",
    title: "Filmkveld i Bergen",
    description:
      "Vi ser en film og prater om den etterpå. Kom som du er, ta med en venn. Gratis popkorn så lenge det varer.",
    startsAt: "2026-09-25T18:30:00+02:00",
    endsAt: "2026-09-25T21:30:00+02:00",
    location: "Ungdomshuset 1880, Bergen",
    isPublic: true,
    hostId: "adrian",
    attendeeIds: ["adrian", "hanne"],
    capacity: 25,
  },
  {
    id: "e-tu-3",
    communityId: "tryggere-ungdom",
    title: "Høstsamling for lokallagene",
    description:
      "Helgesamling med kurs, planlegging og en lang tur hvis været holder. Reise og overnatting dekkes for frivillige.",
    startsAt: "2026-10-17T10:00:00+02:00",
    endsAt: "2026-10-18T15:00:00+02:00",
    location: "Sundvolden",
    isPublic: false,
    hostId: "hanne",
    attendeeIds: ["hanne", "mathea", "adrian", "petter", "ingrid"],
    capacity: 45,
  },
  {
    id: "e-tu-4",
    communityId: "tryggere-ungdom",
    title: "Skolebesøk — Ullern videregående",
    description:
      "Tre klasser på vg2. Vi er to som holder, og trenger én til som kan svare på spørsmål etterpå.",
    startsAt: "2026-09-22T09:00:00+02:00",
    endsAt: "2026-09-22T12:00:00+02:00",
    location: "Ullern videregående skole, Oslo",
    isPublic: false,
    hostId: "mathea",
    attendeeIds: ["mathea", "petter"],
    capacity: 4,
  },

  // ── Under The Rug ─────────────────────────────────────────────────────
  {
    id: "e-utr-1",
    communityId: "under-the-rug",
    title: "Høståpning — Kabelgata",
    description:
      "Fire artister, ett rom, ingen scene. Vi åpner dørene klokka 19 og starter presis 19.30. Baren drives av frivillige, og all inngang går til artistene.",
    startsAt: "2026-09-26T19:00:00+02:00",
    endsAt: "2026-09-27T01:00:00+02:00",
    location: "Kabelgata 37, Oslo",
    isPublic: true,
    hostId: "marte",
    attendeeIds: ["marte", "vilde", "eirik", "oskar", "ingrid", "tobias", "sindre"],
    capacity: 180,
  },
  {
    id: "e-utr-2",
    communityId: "under-the-rug",
    title: "Rigg og gjennomgang",
    description:
      "Vi rigger scene, lys og lyd. Regn med fire timer. Ingen forkunnskaper nødvendig — du får opplæring på stedet. Det blir pizza.",
    startsAt: "2026-09-25T14:00:00+02:00",
    endsAt: "2026-09-25T18:30:00+02:00",
    location: "Kabelgata 37, Oslo",
    isPublic: false,
    hostId: "eirik",
    attendeeIds: ["eirik", "ingrid", "oskar"],
    capacity: 8,
  },
  {
    id: "e-utr-3",
    communityId: "under-the-rug",
    title: "Nattrave",
    description:
      "Seks timer, tre live-sett og to DJ-er på soundsystemet vi har bygget selv. Vi holder på til fem.",
    startsAt: "2026-11-14T22:00:00+01:00",
    endsAt: "2026-11-15T05:00:00+01:00",
    location: "Kabelgata 37, Oslo",
    isPublic: true,
    hostId: "tobias",
    attendeeIds: ["tobias", "marte", "sindre", "eirik", "jonas", "vilde"],
    capacity: 300,
  },
  {
    id: "e-utr-4",
    communityId: "under-the-rug",
    title: "Fellesmøte for frivillige",
    description:
      "Gjennomgang av høstsesongen, fordeling av vakter og en runde på hva som fungerte i vår. Digital deltakelse er mulig.",
    startsAt: "2026-09-16T18:30:00+02:00",
    endsAt: "2026-09-16T20:00:00+02:00",
    location: "Tøyen, Oslo (og digitalt)",
    isPublic: false,
    hostId: "vilde",
    attendeeIds: ["vilde", "marte", "eirik", "ingrid", "oskar", "tobias", "sindre"],
  },
  {
    id: "e-utr-5",
    communityId: "under-the-rug",
    title: "Lydtest med publikum",
    description:
      "Vi tester det nye subbass-oppsettet med folk i rommet. Uformelt, og du trenger ikke kunne noe om lyd for å være til nytte.",
    startsAt: "2026-09-18T19:00:00+02:00",
    endsAt: "2026-09-18T21:30:00+02:00",
    location: "Kabelgata 37, Oslo",
    isPublic: false,
    hostId: "sindre",
    attendeeIds: ["sindre", "eirik", "jonas"],
    capacity: 20,
  },
];
