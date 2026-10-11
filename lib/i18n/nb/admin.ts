/** Administration, settings and the profile editor. */
export const admin = {
  // ── Member administration ─────────────────────────────────────────────
  "admin.eyebrow": "Administrasjon",
  "admin.members.metaTitle": "Medlemmer · Administrasjon · {name}",
  "admin.members.adminsOnly":
    "Det er administratorene i {name} som endrer tilgang og moderatorrettigheter. Som moderator følger du opp samtaler og innhold.",
  "admin.members.lead": "Administrer tilgang og moderatorrettigheter i fellesskapet.",

  // ── Requests ──────────────────────────────────────────────────────────
  "requests.title": "Medlemsforespørsler",
  "requests.adminsOnly":
    "Det er administratorene i {name} som tar stilling til hvem som slipper inn. Som moderator følger du opp samtaler og innhold.",
  "requests.lead":
    "Folk som har bedt om tilgang til {name} fra den offentlige siden. Godkjenner du, blir noen med en TING-konto fra før medlem med det samme — andre får en lenke på e-post for å logge inn eller opprette konto.",
  "requests.sent": "Sendt {date}",
  "requests.reject": "Avslå",
  "requests.rejectYes": "Ja, avslå",
  "requests.approve": "Godkjenn",
  "requests.expired": "Utløpt",
  "requests.expires": "Utløper {when}",
  "requests.sentLower": "sendt {date}",
  "requests.pending": "Venter",
  "requests.resend": "Send på nytt",
  "requests.status.active": "Aktivt medlem",
  "requests.status.awaitingLogin": "Venter på innlogging",
  "requests.status.linkExpired": "Lenken er utløpt",
  "requests.status.rejected": "Avslått",
  "requests.reviewed": "Behandlet {date}",
  "requests.noneHeading": "Ingen forespørsler",
  "requests.waiting.one": "{count} forespørsel venter",
  "requests.waiting.other": "{count} forespørsler venter",
  "requests.empty.title": "Ingen ventende forespørsler",
  "requests.empty.body":
    "Når noen ber om tilgang fra den offentlige siden, havner de her. Godkjenner du, blir noen med en TING-konto fra før medlem med det samme — andre får en lenke på e-post for å logge inn eller opprette konto.",
  "requests.invitations": "Utsendte invitasjoner",
  "requests.noInvitations": "Ingen invitasjoner venter på å bli tatt i bruk.",
  "requests.invitationNote":
    "En invitasjon gjelder én e-postadresse, ett fellesskap og én gang. Sender du på nytt, slutter den forrige lenken å virke.",
  "requests.recent": "Nylig behandlet",

  // ── Account links ─────────────────────────────────────────────────────
  "links.title": "Kontokoblinger",
  "links.adminsOnly":
    "Det er administratorene i {name} som kobler offentlige organisasjonskontakter til TING-kontoer.",
  "links.lead":
    "Koble offentlige organisasjonskontakter til eksisterende TING-kontoer for funksjoner som direkte meldinger.",
  "links.backTo": "Tilbake til {target}",
  "links.unlinked": "Ikke koblet",
  "links.allLinked": "Alle organisasjonskontakter er koblet.",
  "links.linked": "Koblet",
  "links.noneLinked": "Ingen organisasjonskontakter er koblet ennå.",
  "links.accountFor": "TING-konto for {name}",
  "links.chooseMember": "Velg aktivt medlem",
  "links.linkedTo": "Koblet til",
  "links.tingAccount": "TING-konto",
  "links.inactive": "Koblet konto er ikke aktiv i dette fellesskapet",
  "links.switch": "Bytt konto",
  "links.link": "Koble til konto",
  "links.saveSwitch": "Lagre bytte",
  "links.submitLink": "Koble til",
  "links.remove": "Fjern kobling",

  // ── Emojis ────────────────────────────────────────────────────────────
  "emoji.title": "Emojier",
  "emoji.lead":
    "Egne emojier for {name}. De finnes bare her — et annet fellesskap kan verken se dem eller bruke dem, og to fellesskap kan trygt ha hver sin :party:.",
  "emoji.addTitle": "Legg til en emoji",
  "emoji.addHelp":
    "PNG, GIF eller WebP, maks {size}×{size} piksler og 256 KB. Emojien er kun synlig for medlemmer av dette fellesskapet.",
  "emoji.name": "Navn",
  "emoji.namePlaceholder": "emojinavn",
  "emoji.image": "Bilde",
  "emoji.add": "Legg til",
  "emoji.willBe": "Blir tilgjengelig som",
  "emoji.count.one": "{count} egen emoji",
  "emoji.count.other": "{count} egne emojier",
  "emoji.empty.title": "Ingen egne emojier ennå",
  "emoji.empty.manage":
    "Legg til den første over. Den blir umiddelbart tilgjengelig i reaksjonsvelgeren for alle medlemmer her.",
  "emoji.empty.readonly": "Moderatorer og administratorer kan legge til emojier for dette fellesskapet.",
  "emoji.addedBy": "Lagt til av {name} · {date}",
  "emoji.aMember": "et medlem",

  // ── Settings ──────────────────────────────────────────────────────────
  "settings.title": "Innstillinger",
  "settings.none.title": "Ingen innstillinger for deg her ennå",
  "settings.none.body":
    "Innstillingene på denne siden gjelder administratorer og moderatorer i {name}.",
  "settings.lead.admin": "Fellesskapets profil og dine egne valg i {name}.",
  "settings.lead.staff": "Dine egne valg i {name}. De gjelder bare deg, og bare her.",
  "settings.communityProfile": "Fellesskapsprofil",
  "settings.directMessages": "Direkte meldinger",
  "settings.dm.staffOnly":
    "{name} har slått av direkte meldinger mellom medlemmer. Som standard kan medlemmer heller ikke skrive til administratorer og moderatorer — hver enkelt av oss velger selv om vi vil være tilgjengelige.",
  "settings.dm.open":
    "{name} lar medlemmer sende direkte meldinger til hverandre. Da er du allerede tilgjengelig for medlemmene her, og det er ingenting å slå på.",
  "settings.dm.toggle": "Tillat meldinger fra medlemmer",
  "settings.dm.toggleHelp":
    "Når dette er aktivert, kan medlemmer av dette fellesskapet starte en direkte melding med deg.",
  "settings.dm.scope":
    "Innstillingen gjelder kun {name}. Er du med i flere fellesskap, styrer du hvert av dem for seg.",

  // ── Community picture and personal profile ────────────────────────────
  "avatar.title": "Profilbilde",
  "avatar.communityHelp": "Bildet brukes som fellesskapets profilbilde inne i TING.",
  "avatar.communityFormats":
    "PNG, JPEG eller WebP, maks 5 MB. Vises som en firkant, og beskjæres om bildet ikke er kvadratisk.",
  "avatar.chooseImage": "Velg bilde",
  "avatar.change": "Bytt bilde",
  "avatar.upload": "Last opp bilde",
  "avatar.remove": "Fjern bilde",
  "profile.metaTitle": "Profilen din · {name}",
  "profile.title": "Profilen din her",
  "profile.lead":
    "Slik vises du for andre i {name}. Endringer her påvirker ikke profilene dine i andre fellesskap.",
  "profile.photoHelp": "Bildet vises bare i {name}. PNG, JPEG eller WebP, maks 5 MB.",
  "profile.choosePhoto": "Velg profilbilde",
  "profile.displayName": "Visningsnavn",
  "profile.displayNameHelp":
    "Ditt eget navn eller et pseudonym. Andre medlemmer av {name} ser dette navnet.",
  "profile.bio": "Bio",
  "profile.bioPlaceholder":
    "Valgfritt. Et par setninger om deg, slik du vil presentere deg her.",
  "profile.saveChanges": "Lagre endringer",
} as const;
