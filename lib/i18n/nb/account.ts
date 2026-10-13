/**
 * Signing in with a password, choosing and resetting one, and changing the
 * address an account signs in with. Account-level screens: outside a community
 * they are in the platform's language, and the ones a community's invitation
 * leads through take that community's.
 */
export const account = {
  // ── Sign-in page: password ────────────────────────────────────────────
  "login.password.title": "Logg inn på TING",
  "login.passwordLabel": "Passord",
  "login.submit": "Logg inn",
  "login.working": "Logger inn …",
  "login.forgot": "Glemt passord?",
  "login.useLink": "Logg inn med e-postlenke",
  "login.usePassword": "Logg inn med passord",
  "login.link.lead":
    "Vi sender deg en innloggingslenke på e-post. Du trenger ikke passordet ditt.",
  "login.err.missing": "Skriv inn e-postadressen og passordet ditt.",
  "login.err.credentials": "Feil e-postadresse eller passord.",
  "login.err.rate": "For mange forsøk. Vent litt, og prøv igjen.",
  "login.err.wait.one":
    "For mange forsøk. Prøv igjen om ett minutt, eller logg inn med e-postlenke.",
  "login.err.wait.other":
    "For mange forsøk. Prøv igjen om {count} minutter, eller logg inn med e-postlenke.",
  "login.reset.done": "Passordet er endret. Logg inn med det nye passordet.",

  // ── Password fields, shared by every form that sets one ───────────────
  "password.new": "Passord",
  "password.newChange": "Nytt passord",
  "password.confirm": "Gjenta passordet",
  "password.current": "Nåværende passord",
  "password.hint": "Minst {min} tegn. En setning du husker, er bedre enn et kort og innviklet passord.",
  "password.working": "Lagrer …",
  "password.err.tooShort": "Passordet må ha minst {min} tegn.",
  "password.err.tooLong": "Passordet er for langt. Bruk færre enn {max} tegn.",
  "password.err.mismatch": "De to passordene er ikke like.",
  "password.err.pwned": "Dette passordet finnes i kjente datalekkasjer. Velg et annet.",
  "password.err.weak": "Passordet er for svakt. Velg et lengre passord.",
  "password.err.same": "Velg et annet passord enn det du har fra før.",
  "password.err.current": "Det nåværende passordet stemmer ikke.",
  "password.err.rate": "For mange forsøk. Vent litt, og prøv igjen.",
  "password.err.wait.one": "For mange forsøk. Prøv igjen om ett minutt.",
  "password.err.wait.other": "For mange forsøk. Prøv igjen om {count} minutter.",
  "password.err.failed": "Passordet kunne ikke lagres. Prøv igjen.",
  "password.err.unavailable": "Vi får ikke kontakt med innloggingen akkurat nå. Prøv igjen om litt.",
  "password.err.useChange": "Kontoen har allerede et passord. Bruk «Endre passord» og oppgi det nåværende.",
  "password.reauth.title": "Bekreft at det er deg",
  "password.reauth.body":
    "Det er en stund siden du logget inn. Be om en innloggingslenke på e-post, så kan du velge passord med en gang du har brukt den.",
  "password.reauth.action": "Send meg en innloggingslenke",

  // ── Password setup after an approval ──────────────────────────────────
  "setup.metaTitle": "Opprett passord",
  "setup.label": "Ett steg igjen",
  "setup.title": "Opprett passord",
  "setup.lead":
    "Velg et passord du kan bruke for å logge inn på TING, også hvis du senere mister tilgang til e-postkontoen din.",
  "setup.submit": "Opprett passord og fortsett",
  "setup.signedInAs": "Logget inn som {email}.",
  "setup.resume":
    "Når passordet er opprettet, åpner du lenken i godkjennings-e-posten en gang til for å komme inn i fellesskapet.",
  "setup.signOut": "Logg ut",

  // ── Forgotten password ────────────────────────────────────────────────
  "forgot.metaTitle": "Glemt passord",
  "forgot.label": "Glemt passord",
  "forgot.title": "Velg et nytt passord",
  "forgot.lead":
    "Skriv inn e-postadressen du logger inn med, så sender vi en lenke du kan bruke for å velge et nytt passord.",
  "forgot.submit": "Send lenke",
  "forgot.working": "Sender …",
  "forgot.sent.title": "Sjekk e-posten din",
  "forgot.sent.pre": "Hvis adressen er registrert, har vi sendt en lenke til ",
  "forgot.sent.post": ". Den kan brukes én gang.",
  "forgot.noInbox":
    "Har du ikke lenger tilgang til e-postadressen? Da kan lenken ikke nå deg. Logg inn med passordet ditt og endre adressen under Kontoen din → Sikkerhet, eller ta kontakt med en administrator i fellesskapet ditt.",
  "forgot.back": "← Tilbake til innlogging",
  "forgot.err.email": "Skriv inn en gyldig e-postadresse.",

  // ── New password from an emailed link ─────────────────────────────────
  "reset.metaTitle": "Nytt passord",
  "reset.label": "Nytt passord",
  "reset.title": "Velg et nytt passord",
  "reset.lead": "Passordet gjelder for TING-kontoen din, i alle fellesskapene du er med i.",
  "reset.submit": "Lagre nytt passord",
  "reset.invalid.title": "Lenken er brukt eller utløpt",
  "reset.invalid.body":
    "En lenke for å velge nytt passord kan bare brukes én gang, og bare en begrenset tid. Be om en ny, så sender vi den med en gang.",
  "reset.invalid.action": "Be om en ny lenke",
  "reset.retry": "Lenken er brukt, men du er logget inn. Velg et annet passord for å fullføre.",

  // ── Account security ("Kontoen din" → "Sikkerhet") ────────────────────
  "security.heading": "Sikkerhet",
  "security.email": "E-postadresse",
  "security.email.change": "Endre e-postadresse",
  "security.email.pending": "Venter på bekreftelse fra {email}.",
  "security.email.cancel": "Avbryt endringen",
  "security.password": "Passord",
  "security.password.none": "Du har ikke opprettet et passord ennå.",
  "security.password.create": "Opprett passord",
  "security.password.change": "Endre passord",
  "security.password.since": "Sist endret {date}.",
  "security.password.saved": "Passordet er lagret. Du kan nå logge inn med e-postadresse og passord.",
  "security.link": "Du kan også logge inn med en lenke sendt til e-postadressen din.",
  "security.back": "← Tilbake til kontoen din",

  "security.createPassword.metaTitle": "Opprett passord",
  "security.createPassword.title": "Opprett passord",
  "security.createPassword.lead":
    "Med et passord kan du logge inn på TING også hvis du mister tilgang til e-postkontoen din. Innlogging med e-postlenke fungerer som før.",
  "security.createPassword.submit": "Opprett passord",
  "security.changePassword.metaTitle": "Endre passord",
  "security.changePassword.title": "Endre passord",
  "security.changePassword.lead":
    "Oppgi passordet du har nå, og velg et nytt. Du blir logget ut på andre enheter.",
  "security.changePassword.submit": "Endre passord",
  "security.changePassword.forgot": "Husker du ikke passordet? Be om en lenke for å velge et nytt.",

  "security.changeEmail.metaTitle": "Endre e-postadresse",
  "security.changeEmail.title": "Endre e-postadresse",
  "security.changeEmail.lead":
    "Kontoen, medlemskapene og profilene dine følger med til den nye adressen. Du trenger ikke tilgang til den gamle.",
  "security.changeEmail.current": "Nåværende adresse",
  "security.changeEmail.new": "Ny e-postadresse",
  "security.changeEmail.password": "Passordet ditt",
  "security.changeEmail.passwordHint": "Vi ber om passordet for å være sikre på at det er deg.",
  "security.changeEmail.submit": "Send bekreftelse til den nye adressen",
  "security.changeEmail.working": "Sender …",
  "security.changeEmail.sent.title": "Sjekk den nye innboksen",
  "security.changeEmail.sent.pre": "Hvis adressen kan brukes, har vi sendt en bekreftelseslenke til ",
  "security.changeEmail.sent.post":
    ". Adressen endres først når du åpner lenken og bekrefter mens du er logget inn. Til da logger du inn som før.",
  "security.changeEmail.needsPassword.title": "Opprett et passord først",
  "security.changeEmail.needsPassword.body":
    "For å endre e-postadresse må du bekrefte hvem du er med passordet ditt. Kontoen har ikke noe passord ennå.",
  "security.changeEmail.cooldown.title": "Passordet er nylig endret",
  "security.changeEmail.cooldown.body":
    "Av sikkerhetsgrunner kan e-postadressen endres {hours} timer etter at passordet sist ble opprettet eller endret. Du kan endre den fra {date} kl. {time}.",
  "security.changeEmail.err.email": "Skriv inn en gyldig e-postadresse.",
  "security.changeEmail.err.same": "Dette er allerede e-postadressen til kontoen.",
  "security.changeEmail.err.password": "Passordet stemmer ikke.",
  "security.changeEmail.err.cooldown":
    "Passordet er nylig opprettet eller endret. E-postadressen kan endres {hours} timer etter det.",
  "security.changeEmail.err.rate": "Du har nettopp bedt om dette. Vent litt, og prøv igjen.",
  "security.changeEmail.err.failed": "Bekreftelsen kunne ikke sendes. Prøv igjen.",

  // ── Confirming a new address ──────────────────────────────────────────
  "confirmEmail.metaTitle": "Bekreft e-postadresse",
  "confirmEmail.label": "Ny e-postadresse",
  "confirmEmail.title": "Bekreft den nye e-postadressen",
  "confirmEmail.lead": "Kontoen din bytter til {email}. Den gamle adressen kan ikke lenger brukes til å logge inn.",
  "confirmEmail.submit": "Bekreft og bytt adresse",
  "confirmEmail.working": "Bekrefter …",
  "confirmEmail.signIn.body":
    "Logg inn med adressen og passordet du har brukt til nå, så kan du bekrefte den nye adressen. Lenken alene endrer ingenting.",
  "confirmEmail.signIn.action": "Logg inn for å bekrefte",
  "confirmEmail.none.title": "Ingen endring venter",
  "confirmEmail.none.body":
    "Kontoen du er logget inn med ({email}), har ingen e-postendring som venter. Lenken kan være brukt, avbrutt eller høre til en annen konto.",
  "confirmEmail.done.title": "E-postadressen er endret",
  "confirmEmail.done.body": "Du logger nå inn med {email}. Alt annet er som før.",
  "confirmEmail.half.title": "Én bekreftelse igjen",
  "confirmEmail.half.body":
    "Denne lenken er bekreftet. Åpne også lenken som ble sendt til den andre adressen for å fullføre.",
  "confirmEmail.invalid.title": "Lenken er ikke gyldig",
  "confirmEmail.invalid.body": "Lenken mangler noe eller er ufullstendig.",
  "confirmEmail.err.expired": "Lenken er brukt eller utløpt. Be om en ny bekreftelse fra Kontoen din → Sikkerhet.",
  "confirmEmail.err.failed": "Adressen kunne ikke bekreftes. Hører lenken til en annen konto? Prøv igjen om litt, eller be om en ny bekreftelse.",
  "confirmEmail.toAccount": "Til kontoen din",
} as const;
