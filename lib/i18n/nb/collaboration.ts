/**
 * Collaborations: the hub, creating one, invitations, choosing participants,
 * the collaboration persona and the private home.
 *
 * The words deliberately avoid the implementation's vocabulary — nobody is
 * told about sponsorships, participant rows or management seats. A person is
 * "invited to the collaboration team"; an organisation "takes part".
 */
export const collaboration = {
  // ── Hub ───────────────────────────────────────────────────────────────
  "collab.hub.metaTitle": "Samarbeid",
  "collab.hub.eyebrow": "Samarbeid",
  "collab.hub.title": "Samarbeid på tvers",
  "collab.hub.lead":
    "Private arbeidsrom der utvalgte personer fra flere organisasjoner jobber sammen. Hver organisasjon bestemmer selv hvem som deltar.",
  "collab.hub.new": "Nytt samarbeid",
  "collab.hub.yours": "Dine samarbeid",
  "collab.hub.orgInvites": "Invitasjoner til organisasjonen din",
  "collab.hub.personInvites": "Invitasjoner til deg",
  "collab.hub.managed": "Samarbeid du er ansvarlig for",
  "collab.hub.managedLead":
    "Her representerer du organisasjonen din, men er ikke selv med i samarbeidsteamet.",
  "collab.hub.empty.title": "Ingen samarbeid ennå",
  "collab.hub.empty.body":
    "Når organisasjonen din blir invitert til et samarbeid, eller noen velger deg som deltaker, dukker det opp her.",
  "collab.hub.empty.admin":
    "Når organisasjonen din blir invitert til et samarbeid, eller noen velger deg som deltaker, dukker det opp her. Som administrator kan du også starte et selv.",

  "collab.private": "Privat samarbeid",
  "collab.role.organizer": "Deltaker",
  "collab.role.manager": "Samarbeidsansvarlig",
  "collab.enterWorkspace": "Åpne samarbeidet",
  "collab.manage": "Administrer samarbeidet",
  "collab.back": "Samarbeid",

  // ── Create ────────────────────────────────────────────────────────────
  "collab.new.metaTitle": "Nytt samarbeid",
  "collab.new.title": "Start et samarbeid",
  "collab.new.lead":
    "Et privat arbeidsrom for deltakerne i samarbeidet. Publikum hører ikke hjemme her.",
  "collab.new.name": "Navn",
  "collab.new.namePlaceholder": "F.eks. Seminar om narkotikamarkedet",
  "collab.new.description": "Beskrivelse",
  "collab.new.optional": "valgfritt",
  "collab.new.descriptionPlaceholder": "Hva skal dere få til sammen?",
  "collab.new.unit": "På vegne av",
  "collab.new.unitHint":
    "Enhetene du kan representere. Å velge et lokallag gjør deg ikke til medlem av det.",
  "collab.new.wholeOrg": "{name} – hele organisasjonen",
  "collab.new.submit": "Opprett samarbeid",
  "collab.new.notAllowed.title": "Samarbeid startes av en organisasjon",
  "collab.new.notAllowed.body":
    "Det er administratoren i en organisasjon som kan starte et samarbeid på vegne av den, eller av ett av lokallagene.",

  // ── Organisation invitations ──────────────────────────────────────────
  "collab.orgInvite.title": "{name} er invitert til å samarbeide",
  "collab.orgInvite.with": "Deltar allerede: {names}",
  "collab.orgInvite.participateAs": "Delta som",
  "collab.orgInvite.wholeOrg": "Hele {name}",
  "collab.orgInvite.note":
    "Å takke ja gjør organisasjonen til deltaker. Det setter ingen i samarbeidsteamet — det velger dere etterpå, blant deres egne folk.",
  "collab.orgInvite.accept": "Takk ja",
  "collab.orgInvite.decline": "Takk nei",
  "collab.orgInvite.declineNote": "Organisasjonen blir ikke med. Samarbeidet kan invitere dere igjen senere.",
  "collab.orgInvite.declineConfirm": "Ja, takk nei",
  "collab.orgInvite.acceptedUnit": "{unit} deltar nå i samarbeidet.",
  "collab.orgInvite.acceptedNotTeam": "Du er ikke automatisk med i samarbeidsteamet. Velg deltakere blant deres egne folk under.",
  "collab.orgInvite.acceptedOnTeam": "Du er også med i samarbeidsteamet, fordi du selv hører til enheten.",
  "collab.orgInvite.declined": "Invitasjonen er avslått.",
  "collab.orgInvite.acceptFailed":
    "Kunne ikke takke ja. Invitasjonen kan allerede være besvart, eller enheten deltar fra før.",
  "collab.orgInvite.pending": "{name} er invitert. En administrator der må svare.",

  // ── Invitations to a person ───────────────────────────────────────────
  "collab.personInvite.title": "Du er invitert til samarbeidsteamet",
  "collab.personInvite.via": "Invitert gjennom",
  "collab.personInvite.note":
    "Du velger selv hvordan du vises i samarbeidet. Ingen av profilene dine deles automatisk.",
  "collab.personInvite.accept": "Takk ja og bli med",
  "collab.personInvite.decline": "Takk nei",
  "collab.personInvite.declineNote": "Du blir ikke med i samarbeidsteamet. Organisasjonen din ser at du takket nei, og kan invitere deg igjen senere.",
  "collab.personInvite.declineConfirm": "Ja, takk nei",
  "collab.personInvite.acceptFailed": "Kunne ikke bli med. Invitasjonen gjelder kanskje ikke lenger.",
  "collab.personInvite.declined": "Du takket nei.",
  "collab.rejoin.title": "Du har forlatt samarbeidsteamet",
  "collab.rejoin.body": "Du kan bli med igjen så lenge organisasjonen din fortsatt har valgt deg.",
  "collab.rejoin.action": "Bli med igjen",

  // ── The collaboration ─────────────────────────────────────────────────
  "collab.page.about": "Om samarbeidet",
  "collab.page.participating": "Deltakende organisasjoner",
  "collab.page.team": "Samarbeidsteamet",
  "collab.page.you": "deg",
  "collab.page.yourProfile": "Din profil her",
  "collab.page.next.title": "Kommer senere",
  "collab.page.next.body":
    "Samtaler og arbeidsverktøy for deltakerne får plass her etter hvert.",
  "collab.page.managerNotice":
    "Du representerer {unit} i dette samarbeidet.",
  "collab.page.managerNoticeBody":
    "Du kan invitere organisasjoner, velge hvem fra din enhet som skal delta, og trekke enheten ut av samarbeidet. Du er ikke selv med i samarbeidsteamet ennå. For å få tilgang til arbeidsrommet må du velges som deltaker.",
  "collab.page.leave": "Forlat samarbeidsteamet",
  "collab.page.leaveConfirm": "Ja, forlat",
  "collab.page.leaveNote":
    "Du forlater bare samarbeidsteamet. Medlemskapet ditt i organisasjonen påvirkes ikke.",

  // ── Management ────────────────────────────────────────────────────────
  "collab.manage.title": "Ansvar og deltakere",
  "collab.manage.lead":
    "Se organisasjonene som deltar, og administrer deltakerne fra din egen enhet. Andre organisasjoners medlemslister deles ikke.",
  "collab.manage.invited": "Venter på svar",
  "collab.manage.inviteTitle": "Inviter en organisasjon",
  "collab.manage.inviteHint":
    "Skriv inn organisasjonens TING-adresse. Samarbeid i TING er ikke offentlig søkbart, så du må kjenne adressen.",
  "collab.manage.inviteExample": "organisasjonens-adresse",
  "collab.manage.inviteLabel": "TING-adresse",
  "collab.manage.inviteSubmit": "Inviter",
  "collab.invite.failed":
    "Ingen organisasjon kunne inviteres med den adressen. Sjekk at den er skrevet riktig, og at organisasjonen ikke allerede er invitert.",
  "collab.invite.sent": "{name} er invitert. En administrator der må svare.",
  "collab.unit.yours": "Din enhet",
  "collab.unit.chooseOrganizers": "Velg deltakere",
  "collab.unit.withdraw": "Trekk enheten ut",
  "collab.unit.withdrawConfirm": "Ja, trekk ut",
  "collab.unit.withdrawNote":
    "Deltakerne dere har valgt, mister tilgang. Organisasjonen og medlemskapene påvirkes ikke.",
  "collab.unit.withdrawn": "Enheten er trukket ut av samarbeidet.",

  // ── Choosing participants ───────────────────────────────────────────────
  "collab.organizers.metaTitle": "Velg deltakere · {name}",
  "collab.organizers.title": "Velg deltakere",
  "collab.organizers.lead":
    "Velg hvem fra {unit} du vil invitere. Andre organisasjoner ser ikke medlemslisten, og alle må selv takke ja.",
  "collab.organizers.empty": "Ingen aktive medlemmer i denne enheten.",
  "collab.organizers.status.none": "Ikke invitert ennå",
  "collab.organizers.status.invited": "Invitasjon sendt",
  "collab.organizers.status.joined": "Deltar",
  "collab.organizers.status.left": "Har forlatt samarbeidsteamet",
  "collab.organizers.status.accepted": "Deltar",
  "collab.organizers.status.declined": "Avslått",
  "collab.organizers.status.revoked": "Tilgang trukket tilbake",
  "collab.organizers.invite": "Inviter",
  "collab.organizers.reinvite": "Inviter igjen",
  "collab.organizers.revoke": "Trekk tilbake",
  "collab.organizers.revokeNote": "Personen mister plassen i samarbeidsteamet. Medlemskapet i organisasjonen påvirkes ikke.",
  "collab.organizers.revokeConfirm": "Ja, trekk tilbake",
  "collab.organizers.inviteFailed":
    "Kunne ikke invitere. Personen tilhører kanskje ikke lenger enheten.",
  "collab.organizers.you": "deg",

  // ── Collaboration persona ─────────────────────────────────────────────
  "collab.profile.metaTitle": "Din profil · {name}",
  "collab.profile.setupTitle": "Hvordan vil du vises her?",
  "collab.profile.editTitle": "Din profil i samarbeidet",
  "collab.profile.lead":
    "Denne profilen gjelder bare i {name}. Den er atskilt fra profilene dine i organisasjonene, og endringer her påvirker ikke dem.",
  "collab.profile.setupNotice": "Sett opp profilen din i samarbeidet for å fortsette.",
  "collab.profile.startTitle": "Utgangspunkt",
  "collab.profile.startFrom": "Start med profilen min fra {name}",
  "collab.profile.startBlank": "Start blankt",
  "collab.profile.startHint":
    "Et utgangspunkt kopieres én gang. Etterpå er profilene uavhengige av hverandre.",
  "collab.profile.startChosen":
    "Fylt ut fra profilen din i {name}. Ingenting lagres før du trykker lagre.",
  "collab.profile.displayName": "Visningsnavn",
  "collab.profile.displayNameHelp": "Navnet de andre deltakerne ser. Eget navn eller et du velger for anledningen.",
  "collab.profile.bio": "Om deg",
  "collab.profile.bioPlaceholder": "Hva bidrar du med i samarbeidet?",
  "collab.profile.saveFirst": "Lagre og fortsett",
  "collab.profile.saveFailed": "Kunne ikke lagre profilen. Har du fortsatt tilgang til samarbeidet?",

  // ── Errors ────────────────────────────────────────────────────────────
  "collab.err.nameRequired": "Gi samarbeidet et navn.",
  "collab.err.nameTooLong": "Navnet kan ikke være lengre enn {max} tegn.",
  "collab.err.descriptionTooLong": "Beskrivelsen kan ikke være lengre enn {max} tegn.",
  "collab.err.chooseUnit": "Velg hvem du oppretter samarbeidet på vegne av.",
  "collab.err.createRefused":
    "Samarbeidet kunne ikke opprettes. Du må være administrator for enheten du velger.",
  "collab.err.refused": "Det gikk ikke. Du har kanskje ikke lenger tilgang til å gjøre dette.",
} as const;
