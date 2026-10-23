/**
 * Sentences the server says back to someone who just did something: refusals,
 * validation, and confirmations. The data layer and the actions return keys;
 * the action turns them into words in the community's language.
 */
export const errors = {
  // ── Messages and posts ────────────────────────────────────────────────
  "err.messageEmpty": "Meldingen kan ikke være tom.",
  "err.messageTooLong": "Meldingen kan være høyst 4000 tegn.",
  "err.mentionNotAllowed": "Én av personene du nevner, kan ikke nevnes i denne kanalen. Fjern navnet og prøv igjen.",
  "err.mentionTooMany": "Du kan nevne høyst 20 personer i én melding.",
  "err.messageLength": "Meldingen kan være mellom 1 og 4000 tegn.",
  "err.channelWriteDenied": "Du har ikke tilgang til å skrive i denne kanalen.",
  "err.conversationWriteDenied": "Du har ikke tilgang til å skrive i denne samtalen.",
  "err.messageSendFailed": "Meldingen kunne ikke sendes. Prøv igjen.",
  "err.messageNotFound": "Meldingen finnes ikke lenger, eller du har ikke tilgang til den.",
  "err.messageActionDenied": "Du har ikke tilgang til å gjøre dette med meldingen.",
  "err.messageDeleted": "Meldingen er slettet og kan ikke endres.",
  "err.messageEditFailed": "Endringen ble ikke lagret. Prøv igjen.",
  "err.messageDeleteFailed": "Meldingen ble ikke slettet. Prøv igjen.",
  "err.messagePinFailed": "Festingen ble ikke endret. Prøv igjen.",
  "err.conversationOpenFailed": "Samtalen kunne ikke åpnes. Prøv igjen.",
  "err.conversationNotFound": "Samtalen finnes ikke, eller du har ikke tilgang til den.",
  "err.conversationArchiveFailed": "Samtalen kunne ikke arkiveres. Prøv igjen.",
  "err.conversationRestoreFailed": "Samtalen kunne ikke gjenopprettes. Prøv igjen.",
  "err.conversationDeleteFailed": "Samtalen kunne ikke slettes. Prøv igjen.",
  "err.disappearingFailed": "Forsvinnende meldinger kunne ikke endres. Prøv igjen.",
  "err.attachmentNotAllowed": "Du kan ikke legge ved filer i denne samtalen.",
  "err.attachmentNeedsMutual":
    "Fildeling åpnes når dere begge har sendt minst én tekstmelding i denne samtalen.",
  "err.attachmentArchived": "Samtalen er arkivert. Nye filer kan ikke legges ved.",
  "err.attachmentTooLarge": "{name} er for stor. Filer kan være høyst {max} MB her.",
  "err.attachmentTooMany": "Du kan legge ved høyst {max} filer i én melding.",
  "err.attachmentTooManySent": "Meldingen har for mange vedlegg. Fjern noen og prøv igjen.",
  "err.attachmentType":
    "{name} har et format som ikke støttes. Du kan sende bilder (JPG, PNG, WebP, GIF), PDF, DOCX, XLSX, PPTX, TXT, CSV og lyd (MP3, WAV, M4A).",
  "err.attachmentEmpty": "{name} er tom.",
  "err.attachmentUploadFailed": "{name} kunne ikke lastes opp. Prøv igjen.",
  "err.attachmentInvalid":
    "Vedleggene kunne ikke sendes. Fjern dem, last dem opp på nytt og prøv igjen.",
  "err.attachmentStillUploading": "Vent til filene er ferdig lastet opp.",
  "err.attachmentFailedPresent":
    "En av filene kunne ikke lastes opp. Fjern den eller prøv igjen før du sender.",
  "err.postEmpty": "Innlegget kan ikke være tomt.",
  "err.postEditOwn": "Du kan bare endre dine egne innlegg.",
  "err.postDeleteDenied": "Du har ikke tilgang til å slette dette innlegget.",
  "err.pinDenied": "Du har ikke tilgang til å feste innlegg her.",
  "err.publishDenied": "Bare administratorer og moderatorer kan publisere i feeden.",
  "err.postSaveFailed": "Innlegget kunne ikke lagres. Prøv igjen.",
  "err.commentEmpty": "Kommentaren kan ikke være tom.",
  "err.commentEditOwn": "Du kan bare endre dine egne kommentarer.",
  "err.commentDeleteDenied": "Du har ikke tilgang til å slette denne kommentaren.",
  "err.commentDenied": "Du har ikke tilgang til å kommentere her.",
  "err.replyToReply": "Det går ikke an å svare på et svar.",
  "err.commentSaveFailed": "Kommentaren kunne ikke lagres. Prøv igjen.",
  "err.reactionInvalid": "Ugyldig reaksjon.",
  "err.reactionRemoveFailed": "Reaksjonen kunne ikke fjernes.",
  "err.reactionDenied": "Du har ikke tilgang til å reagere her.",
  "err.reactionOtherCommunity": "Denne emojien hører til et annet fellesskap.",
  "err.reactionSaveFailed": "Reaksjonen kunne ikke lagres.",
  "err.reactionNotFound": "Meldingen finnes ikke lenger, eller du har ikke tilgang til den.",
  "err.reactionArchived": "Kanalen er arkivert. Reaksjonene kan ikke endres.",
  "err.reactionClosed": "Samtalen er avsluttet. Du kan ikke reagere her lenger.",
  "err.reactionTooMany": "Du kan ha høyst 20 ulike reaksjoner på én melding.",

  // ── Emojis, images, profiles ──────────────────────────────────────────
  "err.emojiExists": ":{name}: finnes allerede i dette fellesskapet.",
  "err.emojiAddDenied": "Du har ikke tilgang til å legge til emojier her.",
  "err.emojiSaveFailed": "Emojien kunne ikke lagres.",
  "err.emojiDeleteDenied": "Du har ikke tilgang til å slette denne emojien.",
  "err.emojiDeleteFailed": "Emojien kunne ikke slettes.",
  "err.emojiImageRemoveFailed": "Emojibildet kunne ikke fjernes. Prøv igjen.",
  "err.emojiName": "Navnet må være 2–32 tegn: små bokstaver, tall, bindestrek eller understrek.",
  "err.imageUploadFailed": "Bildet kunne ikke lastes opp.",
  "err.imageUploadRetry": "Bildet kunne ikke lastes opp. Prøv igjen.",
  "err.chooseFile": "Velg en bildefil.",
  "err.fileEmpty": "Filen er tom.",
  "err.fileTooLarge": "Filen er større enn {kb} KB.",
  "err.imageFileIncomplete": "{format}-filen er ufullstendig.",
  "err.webpVariant": "WebP-varianten støttes ikke.",
  "err.imageSizeUnreadable": "Klarte ikke lese bildestørrelsen.",
  "err.emojiFormat": "Filen må være PNG, GIF eller WebP.",
  "err.imageTooLarge": "Bildet er {width}×{height}. Maks {max}×{max} piksler.",
  "err.emojiTooSmall": "Bildet er for lite. Minst {min} piksler.",
  "err.avatarFormat": "Bildet må være PNG, JPEG eller WebP.",
  "err.avatarTooBig": "Bildet er for stort. Maks {max} MB.",
  "err.avatarIncomplete": "Bildefilen er ufullstendig.",
  "err.avatarUnreadable": "Klarte ikke lese bildet. Prøv en annen fil.",
  "err.avatarTooSmall": "Bildet er for lite. Minst {min} piksler på hver side.",
  "err.avatarAdminOnly": "Bare administratoren kan endre fellesskapets profilbilde.",
  "err.avatarSaveFailed": "Profilbildet kunne ikke lagres.",
  "err.communityAboutTooLong": "Beskrivelsen er for lang. Maks {max} tegn.",
  "err.channelNameEmpty": "Kanalnavnet kan ikke være tomt.",
  "err.channelNameTooLong": "Kanalnavnet kan være høyst {max} tegn.",
  "err.channelPurposeTooLong": "Beskrivelsen kan være høyst {max} tegn.",
  "err.channelEditFailed": "Kunne ikke lagre endringene. Kun administratorer kan redigere kanalen.",
  "err.channelArchived": "Kanalen er arkivert. Ingen kan skrive her.",
  "err.privateChannelNameTaken": "Det finnes allerede en privat kanal med dette navnet i lokallaget.",
  "err.privateChannelParticipantIneligible":
    "En av deltakerne er ikke lenger aktivt medlem av lokallaget. Fjern personen fra utvalget og prøv igjen.",
  "err.privateChannelCreateRefused":
    "Kanalen ble ikke opprettet. Bare administratorer og lokallagets ledere kan opprette private kanaler.",
  "err.privateChannelAddRefused":
    "Deltakeren ble ikke lagt til. Personen kan allerede være med, ikke være aktivt medlem av lokallaget, eller du har ikke lov til å endre kanalen.",
  "err.privateChannelRemoveRefused": "Deltakeren ble ikke fjernet. Du har ikke lov til å endre denne kanalen.",
  "err.privateChannelManagerRefused":
    "Endringen ble ikke lagret. Bare administratorer kan velge kanalansvarlige, og bare lokallagets ledere kan være det.",
  "err.privateChannelArchiveRefused": "Kanalen ble ikke endret. Du har ikke lov til å administrere denne kanalen.",
  "err.privateChannelDeleteRefused":
    "Kanalen ble ikke slettet. Bare administratorer og kanalansvarlige kan slette en privat kanal.",
  "err.communityAboutSaveFailed": "Kunne ikke lagre endringene. Prøv igjen.",
  "ok.communityAboutSaved": "Endringene er lagret.",
  "err.profileSaveFailed": "Profilen kunne ikke lagres. Prøv igjen.",
  "err.profileOwnOnly":
    "Du kan bare endre din egen profil i fellesskap du er aktivt medlem av.",
  "err.profileInactive":
    "Du kan bare endre profilen din i fellesskap du er aktivt medlem av.",
  "err.nameEmpty": "Skriv inn navnet eller pseudonymet du vil bruke.",
  "err.nameTooLong": "Navnet kan ikke være lengre enn {max} tegn.",
  "err.bioTooLong": "Bioen kan ikke være lengre enn {max} tegn.",
  "ok.avatarUpdated": "Profilbildet er oppdatert.",
  "ok.avatarRemoved": "Profilbildet er fjernet.",
  "ok.avatarRemovedInitials": "Profilbildet er fjernet. Initialene dine vises igjen.",
  "ok.profileSaved": "Profilen er lagret.",

  // ── Events and local groups ───────────────────────────────────────────
  "err.eventFull": "Arrangementet er fullt. Ingen flere plasser akkurat nå.",
  "err.rsvpRefused": "Påmeldingen kunne ikke lagres. Prøv igjen.",
  "err.eventCreateRefused":
    "Arrangementet ble ikke opprettet. Bare administratorer, og lokallagsledere for sitt eget lokallag, kan legge inn arrangementer.",
  "err.eventEditRefused":
    "Endringen ble ikke lagret. Bare administratorer, og lokallagsledere for sitt eget lokallag, kan endre arrangementer.",
  "err.eventCapacityBelowAttendees": "Antall plasser kan ikke være lavere enn antall påmeldte ({count}).",
  "err.eventManageRefused":
    "Handlingen ble ikke utført. Bare administratorer, og lokallagsledere for sitt eget lokallag, kan avlyse eller gjenopprette arrangementer.",
  "err.eventAlreadyCancelled": "Arrangementet er allerede avlyst.",
  "err.eventNotCancelled": "Arrangementet er ikke avlyst.",
  "err.eventAlreadyEnded": "Arrangementet er allerede gjennomført.",
  "err.eventRestoreOverCapacity":
    "Arrangementet kan ikke gjenopprettes fordi det er flere påmeldte enn plasser. Øk antall plasser først.",
  "err.eventDeleteRefused":
    "Arrangementet ble ikke slettet. Bare administratorer i fellesskapet kan slette arrangementer permanent.",
  "err.eventDeleteUnconfirmed": "Bekreft at du forstår at slettingen ikke kan angres.",
  "err.attendeeRemoveRefused":
    "Påmeldingen ble ikke fjernet. Bare administratorer, og lokallagsledere for sitt eget lokallag, kan fjerne påmeldinger.",
  "err.attendeeRemoveCancelled": "Arrangementet er avlyst, og påmeldingene tas vare på som historikk.",
  "err.attendeeRemoveNotAttending": "Personen er ikke lenger påmeldt.",
  "err.eventTitleRequired": "Arrangementet må ha en tittel.",
  "err.eventTitleTooLong": "Tittelen kan være høyst 120 tegn.",
  "err.eventLocationRequired": "Legg inn et sted.",
  "err.eventLocationTooLong": "Stedet kan være høyst 120 tegn.",
  "err.eventDescriptionTooLong": "Beskrivelsen kan være høyst 4000 tegn.",
  "err.eventDatesRequired": "Fyll inn dato, start og slutt.",
  "err.eventDatesUnreadable": "Dato eller klokkeslett kunne ikke leses.",
  "err.eventEndsBeforeStart": "Arrangementet må slutte etter at det har begynt.",
  "err.eventCapacityInvalid": "Antall plasser må være et helt tall, eller stå tomt.",
  "err.localGroupSelectionRefused":
    "Lokallaget kunne ikke velges. Det kan være avviklet, eller høre til et annet fellesskap.",
  "err.localGroupAdminRefused":
    "Endringen ble ikke utført. Bare administratorer i dette fellesskapet kan endre lokallag.",
  "err.localGroupLeaderPick": "Velg et medlem først.",
  "err.localGroupLeaderAddRefused":
    "Lederen ble ikke utnevnt. Bare administratorer kan utnevne lokallagsledere, og bare aktive medlemmer av dette lokallaget kan utnevnes.",
  "err.localGroupLeaderRemoveRefused":
    "Lederen ble ikke fjernet. Bare administratorer kan fjerne lokallagsledere, eller personen var allerede fjernet.",
  "err.eventScopedNotPublic":
    "Et arrangement for et lokallag eller en gruppe kan ikke være åpent. Fjern avhukingen for åpent arrangement, eller velg hele fellesskapet.",
  "err.subgroupPickMember": "Velg et medlem å legge til.",
  "err.subgroupAddRefused":
    "Medlemmet ble ikke lagt til. Personen kan allerede være med, ikke være aktivt medlem, eller du har ikke lov til å endre gruppen.",
  "err.subgroupRemoveRefused":
    "Medlemmet ble ikke fjernet. Du har ikke lov til å endre denne gruppen, eller personen er gruppeansvarlig og kan bare fjernes av en administrator.",
  "err.subgroupNameEmpty": "Gruppen må ha et navn.",
  "err.subgroupNameTooLong": "Gruppenavnet kan være høyst {max} tegn.",
  "err.subgroupDescriptionTooLong": "Beskrivelsen kan være høyst {max} tegn.",
  "err.subgroupMemberIneligible":
    "En av de valgte er ikke lenger aktivt medlem av fellesskapet. Fjern personen fra utvalget og prøv igjen.",
  "err.subgroupCreateRefused":
    "Gruppen ble ikke opprettet. Bare administratorer og moderatorer kan opprette grupper.",
  "err.subgroupEditRefused": "Endringene ble ikke lagret. Du har ikke lov til å administrere denne gruppen.",
  "err.subgroupManagerRefused":
    "Endringen ble ikke lagret. Bare administratorer kan velge gruppeansvarlige, og bare medlemmer av gruppen kan være det.",
  "err.subgroupArchiveRefused": "Gruppen ble ikke endret. Du har ikke lov til å administrere denne gruppen.",
  "err.subgroupDeleteRefused":
    "Gruppen ble ikke slettet. Bare administratorer og gruppeansvarlige kan slette en gruppe.",
  "err.subgroupDeleteHasContent":
    "Gruppen ble ikke slettet fordi det er publisert innlegg eller arrangementer til den. Slett dem først, eller arkiver gruppen.",
  "err.localGroupNameRequired": "Lokallaget må ha et navn.",

  // ── Settings, requests and invitations ────────────────────────────────
  "err.dmSettingFailed":
    "Innstillingen kunne ikke endres. Bare administratorer og moderatorer kan endre denne.",
  "err.emailInvalid": "Skriv inn en gyldig e-postadresse.",
  "err.requestFailed": "Vi kunne ikke sende forespørselen. Sjekk opplysningene og prøv igjen.",
  "ok.requestSent": "Takk. Forespørselen din er sendt til en administrator.",
  "err.approveFailed": "Forespørselen kunne ikke godkjennes.",
  "ok.approvedActivatedSent":
    "Godkjent. {email} hadde allerede en TING-konto, så tilgangen er aktiv med det samme. En velkomst-e-post med innloggingslenke er sendt.",
  "ok.approvedActivatedMailFailed":
    "Godkjent. {email} hadde allerede en TING-konto, så tilgangen er aktiv – men velkomst-e-posten kunne ikke sendes.",
  "ok.approvedAlready":
    "Forespørselen var allerede godkjent. Lenken for å logge inn står ved lag.",
  "ok.approvedSent": "Godkjent. En lenke for å logge inn er sendt til {email}.",
  "ok.rejected": "Forespørselen er avslått.",
  "err.rejectFailed": "Forespørselen kunne ikke avslås.",
  "err.resendFailed": "Invitasjonen kunne ikke sendes på nytt.",
  "ok.resent": "Ny invitasjon sendt til {email}.",
  "err.noInvitation": "Ingen invitasjon å sende.",
  "err.emailNotSent": "Invitasjonen er opprettet, men e-posten kunne ikke sendes: {error}",
  "err.email.temporary":
    "E-posttjenesten svarte ikke, eller ba oss prøve igjen senere. Send invitasjonen på nytt om litt.",
  "err.email.rejected":
    "E-posttjenesten avviste meldingen eller mottakeradressen. Kontroller adressen før du sender på nytt.",
  "err.email.configuration":
    "Utsending av e-post er ikke satt opp riktig på denne installasjonen. Kontakt den som drifter TING, og send invitasjonen på nytt etterpå.",
  "err.email.uncertain":
    "Forbindelsen ble brutt mens e-posten ble sendt, så det er uvisst om den kom fram. Spør mottakeren før du sender en ny – en ny invitasjon gjør den forrige ugyldig.",
  "err.invitation.mismatch":
    "Invitasjonen er sendt til en annen e-postadresse enn den du er logget inn med. Logg inn med adressen invitasjonen ble sendt til.",
  "err.invitation.used": "Denne invitasjonen er allerede brukt.",
  "err.invitation.expired": "Invitasjonen er utløpt. Be en administrator om å sende en ny.",
  "err.invitation.revoked":
    "Invitasjonen er erstattet av en nyere. Bruk den siste lenken du fikk.",
  "err.invitation.invalid": "Invitasjonen er ikke gyldig.",
  "err.invitation.adminTaken": "Fellesskapet har fått en annen administrator i mellomtiden. Ta kontakt med TING.",
  "err.authUnavailable": "Vi får ikke kontakt med innloggingen akkurat nå. Lenken er ikke brukt opp – prøv igjen om litt.",
  "err.notificationsFailed": "Varslene kunne ikke merkes som lest. Prøv igjen.",
} as const;
