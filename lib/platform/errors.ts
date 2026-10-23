/**
 * What a platform database function's refusal means, in Norwegian.
 *
 * The functions raise short codes (`slug-taken`, `platform-mfa-required`, …)
 * as their message. Only those codes are ever shown; anything else — an
 * unexpected database error — becomes one generic sentence, and the original
 * goes to the server log without any form input, so no internal detail or
 * secret reaches the browser.
 */
const MESSAGES: Record<string, string> = {
  "platform-forbidden": "Du har ikke tilgang til plattformadministrasjonen.",
  "platform-mfa-required": "Bekreft med engangskoden fra autentiseringsappen før du fortsetter.",
  "platform-owner-required": "Bare plattformeiere kan gjøre dette.",
  "platform-reauth-required": "Bekreft med en ny engangskode. Endringer i hvem som har tilgang krever en bekreftelse de siste ti minuttene.",
  "invalid-input": "Noen av feltene er ikke gyldige. Se over og prøv igjen.",
  "invalid-id": "Identifikatoren er ikke gyldig.",
  "invalid-slug": "Portaladressen er ikke gyldig.",
  "invalid-name": "Navnet må være mellom 2 og 80 tegn.",
  "invalid-text": "En av tekstene er for lang.",
  "invalid-year": "Årstallet er ikke gyldig.",
  "invalid-color": "Fargen må være en heksadesimal farge, som #1f4a3d.",
  "invalid-monogram": "Monogrammet må være én til tre bokstaver eller tall.",
  "invalid-email": "E-postadressen er ikke gyldig.",
  "invalid-reason": "Skriv en begrunnelse på mellom 3 og 1000 tegn.",
  "id-taken": "Et fellesskap har allerede denne identifikatoren.",
  "slug-taken": "Et fellesskap bruker allerede denne portaladressen.",
  "community-not-found": "Fellesskapet finnes ikke.",
  "request-not-found": "Forespørselen finnes ikke.",
  "request-rejected": "Forespørselen er avslått og kan ikke brukes til å opprette et fellesskap.",
  "request-already-provisioned": "Det er allerede opprettet et fellesskap for denne forespørselen.",
  "request-not-pending": "Forespørselen er allerede behandlet.",
  "admin-exists": "Fellesskapet har allerede en administrator. Fjern administratorrollen først, eller velg å erstatte (krever en eksisterende konto).",
  "account-unavailable": "Kontoen er sperret og kan ikke få administratorrollen.",
  "no-admin": "Fellesskapet har ingen administrator.",
  "invitation-not-open": "Invitasjonen er allerede brukt eller trukket tilbake.",
  "rate-limited": "For mange invitasjoner til denne adressen den siste timen. Vent litt.",
  "already-suspended": "Fellesskapet er allerede suspendert.",
  "not-suspended": "Fellesskapet er ikke suspendert.",
  "account-not-ready": "Ingen konto med bekreftet adresse og passord har denne e-postadressen. Personen oppretter kontoen selv på /login og velger passord først.",
  "already-operator": "Personen er allerede plattformadministrator. Endre rollen i listen i stedet.",
  "operator-not-found": "Fant ingen aktiv plattformadministrator med denne kontoen.",
  self: "Du kan ikke endre din egen tilgang. Be en annen plattformeier.",
  "last-owner": "TING må alltid ha minst én aktiv plattformeier. Utnevn en annen eier først.",
  "community-suspended": "Fellesskapet er suspendert.",
};

const GENERIC = "Noe gikk galt. Ingenting ble endret. Prøv igjen, eller se serverloggen.";

export type DatabaseError = { message?: string; code?: string; details?: string | null } | null | undefined;

/** The refusal's code, when it is one of ours; constraint races mapped too. */
export function platformErrorCode(error: DatabaseError): string | undefined {
  if (!error) return undefined;
  const message = error.message ?? "";
  if (MESSAGES[message]) return message;
  if (error.code === "23505") {
    if (message.includes("communities_slug_key")) return "slug-taken";
    if (message.includes("communities_pkey")) return "id-taken";
    if (message.includes("memberships_one_active_admin")) return "admin-exists";
  }
  if (message.includes("last-owner")) return "last-owner";
  return undefined;
}

export function platformErrorMessage(error: DatabaseError, context: string): string {
  const code = platformErrorCode(error);
  if (code) return MESSAGES[code];
  // Logged without form values: the code and Postgres' own message only.
  console.error(`[platform-admin] ${context}: ${error?.code ?? "?"} ${error?.message ?? "ukjent feil"}`);
  return GENERIC;
}

export function messageFor(code: string): string {
  return MESSAGES[code] ?? GENERIC;
}
