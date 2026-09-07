/**
 * The accounts the seed script creates, listed here rather than queried.
 *
 * Reading them from the database would mean an unauthenticated visitor could
 * list profiles, which is exactly what this platform does not do. This is demo
 * scaffolding: the login screen only shows it when NEXT_PUBLIC_ENABLE_DEMO_LOGIN
 * is on, and the seed is the only thing that creates these accounts.
 */
export interface DemoAccount {
  email: string;
  name: string;
  initials: string;
  /** What this account is here to demonstrate. */
  summary: string;
  access: string;
}

export const demoAccounts: DemoAccount[] = [
  {
    email: "ingrid.hovden@posteo.no",
    name: "Ingrid Hovden",
    initials: "IH",
    summary:
      "Jobber med rusreform på dagtid, bygger lydanlegg på kveldstid. Liker møtereferater som faktisk blir lest.",
    access:
      "Tre fellesskap i to helt uavhengige organisasjoner: administrator i Tryggere Ruspolitikk, moderator i Tryggere Ungdom, medlem i Under The Rug.",
  },
  {
    email: "jonas@aalborg.audio",
    name: "Jonas Aalborg",
    initials: "JA",
    summary:
      "Produsent og mastering-ingeniør. Pendler mellom Bergen og Berlin oftere enn jeg burde.",
    access: "Ett fellesskap: medlem i Under The Rug.",
  },
  {
    email: "sofie.lind@protonmail.com",
    name: "Sofie Lind",
    initials: "SL",
    summary: "Nyutdannet sosionom. Ser etter steder å bidra frivillig.",
    access: "Ingen fellesskap, men én invitasjon til Tryggere Ungdom som venter.",
  },
];
