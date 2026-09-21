import type { User } from "@/lib/types";

/**
 * The people in the fixtures.
 *
 * The three accounts at the top cover the membership shapes the product has to
 * handle — many communities, exactly one, and none at all — and the rest
 * populate member lists, threads and events. They were once offered by name on
 * a demo login screen, backed by a shared password; that path went in 50fe465,
 * and a showcase visitor now arrives through `/demo/<token>` as one of the two
 * personas in `demo-personas.ts`. The three stayed because the shapes they
 * cover are still worth having, not because anything signs in as them.
 *
 * A person's communities are unrelated to each other: an account is held by the
 * individual, not by any organisation, so the same person turns up in a civic
 * organisation and an independent cultural collective with no connection
 * between the two.
 */
export const users: User[] = [
  {
    id: "ingrid",
    name: "Ingrid Hovden",
    handle: "ingrid",
    initials: "IH",
    email: "ingrid.hovden@posteo.no",
    pronoun: "hun/henne",
    location: "Oslo",
    bio: "Jobber med rusreform på dagtid, bygger lydanlegg på kveldstid. Liker møtereferater som faktisk blir lest.",
    joinedAt: "2024-02-11",
  },
  {
    id: "jonas",
    name: "Jonas Aalborg",
    handle: "jonas",
    initials: "JA",
    email: "jonas@aalborg.audio",
    pronoun: "han/ham",
    location: "Bergen",
    bio: "Produsent og mastering-ingeniør. Pendler mellom Bergen og Berlin oftere enn jeg burde.",
    joinedAt: "2025-08-30",
  },
  {
    id: "sofie",
    name: "Sofie Lind",
    handle: "sofie",
    initials: "SL",
    email: "sofie.lind@protonmail.com",
    pronoun: "hun/henne",
    location: "Trondheim",
    bio: "Nyutdannet sosionom. Ser etter steder å bidra frivillig.",
    joinedAt: "2026-09-01",
  },

  {
    id: "amina",
    name: "Amina Sørhaug",
    handle: "amina",
    initials: "AS",
    email: "amina@tryggereruspolitikk.no",
    pronoun: "hun/henne",
    location: "Oslo",
    bio: "Fagansvarlig. Skriver høringssvar og holder styr på tallene.",
    joinedAt: "2023-09-04",
  },
  {
    id: "kristoffer",
    name: "Kristoffer Berg",
    handle: "kristoffer",
    initials: "KB",
    email: "kristoffer.berg@gmail.com",
    pronoun: "han/ham",
    location: "Oslo",
    bio: "Frivillig siden 2021. Står som regel i standen på Youngstorget.",
    joinedAt: "2023-11-19",
  },
  {
    id: "marte",
    name: "Marte Fjeldstad",
    handle: "marte",
    initials: "MF",
    email: "marte@undertherug.no",
    pronoun: "hun/henne",
    location: "Oslo",
    bio: "Kurator og booking. Under The Rug siden første kjellerkveld.",
    joinedAt: "2023-05-22",
  },
  {
    id: "eirik",
    name: "Eirik Ravndal",
    handle: "eirik",
    initials: "ER",
    email: "eirik.ravndal@icloud.com",
    pronoun: "han/ham",
    location: "Stavanger",
    bio: "Lys og scenografi. Har alltid med for mye gaffateip.",
    joinedAt: "2024-03-07",
  },
  {
    id: "hanne",
    name: "Hanne Nordbø",
    handle: "hanne",
    initials: "HN",
    email: "hanne@tryggereungdom.no",
    pronoun: "hun/henne",
    location: "Oslo",
    bio: "Ungdomskoordinator. Planlegger kurs og turer, og passer på at ingen blir sittende alene på første samling.",
    joinedAt: "2023-01-16",
  },
  {
    id: "tobias",
    name: "Tobias Wik",
    handle: "tobias",
    initials: "TW",
    email: "tobias.wik@fastmail.com",
    pronoun: "han/ham",
    location: "Berlin",
    bio: "DJ og booking. Sender forslag videre til folk som faktisk svarer.",
    joinedAt: "2023-04-02",
  },
  {
    id: "linn",
    name: "Linn Persen",
    handle: "linn",
    initials: "LP",
    email: "linn.persen@uit.no",
    pronoun: "hun/henne",
    location: "Tromsø",
    bio: "Stipendiat i helsetjenesteforskning. Skadereduksjon i nord.",
    joinedAt: "2024-08-27",
  },
  {
    id: "oskar",
    name: "Oskar Lie",
    handle: "oskar",
    initials: "OL",
    email: "oskar@lie.studio",
    pronoun: "han/ham",
    location: "Oslo",
    bio: "Grafisk designer. Plakater, omslag og altfor mange fonter.",
    joinedAt: "2024-01-09",
  },
  {
    id: "nadia",
    name: "Nadia Rashid",
    handle: "nadia",
    initials: "NR",
    email: "nadia.rashid@outlook.com",
    pronoun: "hun/henne",
    location: "Drammen",
    bio: "Erfaringskonsulent. Snakker med politikere som ikke har hørt etter før.",
    joinedAt: "2024-05-30",
  },
  {
    id: "petter",
    name: "Petter Aune",
    handle: "petter",
    initials: "PA",
    email: "petter.aune@gmail.com",
    pronoun: "han/ham",
    location: "Trondheim",
    bio: "Frivillig i standgruppa. Studerer statsvitenskap.",
    joinedAt: "2025-02-14",
  },
  {
    id: "vilde",
    name: "Vilde Krogh",
    handle: "vilde",
    initials: "VK",
    email: "vilde@undertherug.no",
    pronoun: "hun/henne",
    location: "Oslo",
    bio: "Produsent. Holder kalenderen og budsjettet i samme dokument.",
    joinedAt: "2023-06-12",
  },
  {
    id: "sindre",
    name: "Sindre Kalstad",
    handle: "sindre",
    initials: "SK",
    email: "sindre.kalstad@fastmail.com",
    pronoun: "han/ham",
    location: "Oslo",
    bio: "Lyd og teknikk. Bygger modulære systemer som aldri blir helt ferdige.",
    joinedAt: "2023-02-28",
  },
  {
    id: "elise",
    name: "Elise Damsgaard",
    handle: "elise",
    initials: "ED",
    email: "elise.damsgaard@gmail.com",
    pronoun: "hun/henne",
    location: "Oslo",
    bio: "Jurist. Bidrar med høringsarbeid ved siden av jobben.",
    joinedAt: "2025-01-20",
  },
  {
    id: "mathea",
    name: "Mathea Bjørnstad",
    handle: "mathea",
    initials: "MB",
    email: "mathea.bjornstad@gmail.com",
    pronoun: "hun/henne",
    location: "Oslo",
    bio: "Studerer sosialt arbeid. Har vært frivillig siden jeg var seksten, og blir fortsatt like nervøs før hver samling.",
    joinedAt: "2024-04-15",
  },
  {
    id: "adrian",
    name: "Adrian Fosse",
    handle: "adrian",
    initials: "AF",
    email: "adrian.fosse@outlook.com",
    pronoun: "han/ham",
    location: "Bergen",
    bio: "Lærling som elektriker. Kom med etter et kurs på skolen, og ble værende.",
    joinedAt: "2025-09-08",
  },
];

/**
 * The three membership shapes, in order: many communities, one, none.
 *
 * Not the showcase personas — those live in `demo-personas.ts`, and they are
 * the only accounts a `/demo/<token>` link signs anyone in as.
 * These three are a fixture-coverage guarantee: `check-content.ts` asserts that
 * Ingrid is in all three communities, Jonas in exactly one, and Sofie in none
 * and with no membership row at all, so the empty and cold-start screens always
 * have an account that actually reaches them.
 */
export const demoUserIds = ["ingrid", "jonas", "sofie"];
