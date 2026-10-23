# Plattformadministrasjon (`/platform-admin`)

TINGs eget driftsverktøy: opprette og følge opp organisasjoner, behandle
forespørsler, suspendere og reaktivere, og styre hvem som driver plattformen.
Alt ligger i databasen
(`supabase/migrations/20261113100000_platform_administration.sql`); sidene er
et skall rundt databasefunksjonene.

| Side | Hva |
| --- | --- |
| `/platform-admin` | Oversikt: antall fellesskap (aktive/suspenderte), ventende forespørsler, siste aktivitet |
| `/platform-admin/fellesskap` | Søk og filtrer; status, administrator, antall aktive medlemmer, opprettet |
| `/platform-admin/fellesskap/nytt` | Veiviser for nytt fellesskap (eventuelt fra en forespørsel) |
| `/platform-admin/fellesskap/<id>` | Driftsinformasjon, administrator, innstillinger, logo, suspensjon, aktivitet |
| `/platform-admin/foresporsler` | Forespørsler fra `/samarbeid`: venter / godkjent / avslått |
| `/platform-admin/administratorer` | Plattformeiere og -operatører (bare eiere) |
| `/platform-admin/aktivitetslogg` | Revisjonsloggen |
| `/samarbeid` | Det offentlige skjemaet organisasjoner bruker for å be om å bli med |

## Roller

| Rolle | Kan | Kan ikke |
| --- | --- | --- |
| **Plattformeier** | Alt under, og utnevne, endre og fjerne plattformadministratorer; se hele revisjonsloggen | Endre sin egen tilgang; fjerne siste aktive eier |
| **Plattformoperatør** | Opprette, endre, suspendere og reaktivere fellesskap; utnevne fellesskapsadministratorer; behandle forespørsler; se den operative delen av loggen | Utnevne eller endre plattformadministratorer (heller ikke seg selv); se tilgangsendringer i loggen |
| **Fellesskapsadministrator** | Som før, i sitt eget fellesskap | Noe som helst på plattformnivå |

Plattformroller ligger i `platform_operators`, helt adskilt fra
`memberships`. Ingen operatør blir medlem av noe fellesskap ved å være
operatør, og ingen fellesskapsrolle gir plattformtilgang.

## Slik avgjøres tilgang

Standard er nei. Ingen API-rolle har noen rettighet på plattformtabellene;
alt går gjennom `SECURITY DEFINER`-funksjoner som begynner med
`platform_require()`. Den spør databasen og den verifiserte JWT-en – aldri
noe klienten sier:

1. Er `auth.uid()` en aktiv (ikke fjernet) plattformadministrator? Ellers `platform-forbidden`.
2. Finnes sesjonen fortsatt (ikke logget ut)? Ellers `platform-forbidden`.
3. Er sesjonen på **AAL2** – bekreftet med en andre faktor (TOTP)? Ellers `platform-mfa-required`.
4. For eierhandlinger: er rollen `owner`? Ellers `platform-owner-required`.
5. For endringer i hvem som har tilgang (utnevne, endre rolle, fjerne):
   en MFA-bekreftelse de siste **ti minuttene** (fra sesjonens `amr`)? Ellers
   `platform-reauth-required`. Dashbordet ber om en ny kode.

Rollen leses på nytt ved hver forespørsel, så en fjernet operatør mister
tilgangen ved neste kall – samme token, ingen venting.

Sidene gjør en egen, tidlig sjekk (`lib/platform/access.ts`) bare for å vite
hva som skal vises: alle som ikke er operatører – utlogget, vanlig bruker,
fellesskapsadministrator – får nettstedets vanlige 404. Siden bekrefter ikke at
den finnes. En operatør uten AAL2 i økten får bare MFA-steget.

Andre beskyttelser:

- Ingen administrator står i koden, i en migrasjon eller i en miljøvariabel,
  og ingenting avgjøres av en e-postadresse alene.
- Siste aktive eier kan ikke fjernes eller degraderes av en API-kaller
  (trigger `platform_operators_keep_an_owner`, med lås mot samtidige endringer).
- Serverhandlingene i `app/platform-admin/actions.ts` tar aldri en rolle,
  operatør-id eller «er eier» fra skjemaet.
- `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` og
  `X-Frame-Options: DENY` på alle `/platform-admin`-svar (`next.config.ts`),
  `robots: noindex` i metadata, og generiske sidetitler uten navn eller adresser.

## Personvern: infrastruktur, ikke innhold

Plattformfunksjonene returnerer metadata: navn, identifikator, portaladresse,
status, innstillinger, den ene administratorens navn og adresse, antall aktive
medlemmer og moderatorer. Ingen funksjon kan returnere meldinger,
direktemeldinger, kanaler, innlegg, dokumenter eller medlemslister, og ingen
policy eller predikat som avgjør tilgang til innhold nevner plattformroller.
Fellesskapets egen «Om»-tekst, lenker, kanaler og grupper kan ikke endres
herfra – det er administratorens.

Antall medlemmer vises for operatører selv om README sier at tallet ellers
bare vises til den som kan se medlemslisten. Det er et bevisst unntak: et
aggregat som drift trenger (kapasitet, oppfølging), uten navn.

Det finnes ingen «se som», ingen impersonering og ingen innmelding av
operatører.

**Grensen gjelder applikasjonen.** Under den har `postgres`-rollen og
service-role-nøkkelen (`SUPABASE_SERVICE_ROLE_KEY`) full tilgang til alt.
Den som har databasepassordet eller nøkkelen, kan lese alt innhold. Det er
nettopp derfor operatørrollen er laget svakere enn nøkkelen: daglig drift skal
ikke kreve den.

## Nytt fellesskap

`platform_create_community()` gjør alt i én transaksjon: fellesskapsraden med
innstillinger, plattformraden (`community_platform_state`: når, av hvem,
skjemanøkkel, forespørsel), godkjenning og kobling av forespørselen, og den
første administratoren eller invitasjonen. Feiler noe underveis, finnes
ingenting etterpå.

Et nytt fellesskap har ingen kanaler, seksjoner, innlegg eller medlemmer – som
`npm run bootstrap` (se README, «Første installasjon»). Plattformoverskriftene
for lokallag og grupper er globale rader fra migrasjonene, og en
fellesskapsprofil lages når et medlemskap blir aktivt.

Standardvalgene er de strengeste: bare invitasjon, medlemsliste bare for
administratoren, direktemeldinger bare til ansvarlige som tar imot dem.

Hver visning av veiviseren lager en engangsnøkkel. Samme skjema sendt to
ganger (dobbeltklikk, nytt forsøk etter tidsavbrudd) gir det samme ene
fellesskapet. Identifikator og portaladresse må være unike og kan ikke være et
ord nettstedet bruker selv (`login`, `community`, `platform-admin` …).

## Fellesskapets administrator

Et fellesskap har **én** aktiv administrator
(`memberships_one_active_admin_per_community_idx`). Identiteten kommer fra
Supabase Auth, ikke fra adressen alene:

- **Konto med bekreftet adresse og passord:** blir administrator med en gang
  og får beskjed (varsel og e-post). Personen har allerede bevist adressen.
- **Alt annet** (ingen konto, ubekreftet, uten passord): en
  administratorinvitasjon (`invitations.role = 'admin'`) på e-post, gjennom den
  vanlige invitasjonsflyten. Bare en innlogget konto med akkurat den adressen
  kan ta den i bruk, passordet må være valgt først, og den kan brukes én gang.
  Den nekter hvis noen andre er blitt administrator i mellomtiden.

Nye invitasjoner trekker tilbake tidligere administratorinvitasjoner i samme
fellesskap. «Erstatt» bytter administrator for en eksisterende konto; den
forrige blir vanlig medlem. «Fjern administratorrollen» gjør administratoren
til vanlig medlem – ingenting slettes. En fellesskapsadministrator kan ikke
sende en administratorinvitasjon på nytt fra sin egen kø.

## Suspensjon

Et suspendert fellesskap beholder alt – medlemskap, meldinger, filer – og
ingen kan bruke det:

| | Når suspendert |
| --- | --- |
| Medlemmer | Ser «<navn> er suspendert» og ingenting annet. Eget medlemskap er synlig, alt annet skjult |
| Lesing | Ingen meldinger, kanaler, innlegg, arrangementer, direktemeldinger, profiler, varsler fra fellesskapet |
| Skriving | Alt avvises (`community-suspended`), også via Supabase-API-et direkte og via alle databasefunksjoner |
| Portalen | Svarer 404; tilgangsskjemaet svarer som før men lagrer ingenting; invitasjoner åpnes ikke |
| Tjenesterollen | Ikke blokkert: oppryddingen (vedlegg, forsvinnende meldinger) fortsetter |
| Plattformen | Kan endre informasjon, fjerne administratorrollen, trekke tilbake invitasjoner og reaktivere. Å utnevne en ny administrator krever at fellesskapet er aktivt |

Tre lag, fordi funksjonene kjører som `postgres`, som radsikkerhet ikke binder:

1. **Predikatene.** De 27 funksjonene som gir noe ut fra et aktivt medlemskap
   (`is_member`, `is_admin`, `content_scope_admits` …) krever nå også at
   fellesskapet ikke er suspendert. Alle policyer og funksjoner som avgjør
   tilgang går gjennom dem. En senere migrasjon som definerer en av dem på nytt,
   må beholde betingelsen – `npm run check:platform-admin` feiler ellers.
2. **Restriktive policyer** på fellesskapets tabeller, som et lag som ikke
   avhenger av (1).
3. **Triggere** på hver fellesskapstabell som avviser insert/update/delete fra
   API-kallere mens fellesskapet er suspendert. Triggere slår til også inne i
   `SECURITY DEFINER`-funksjoner.

**Ikke omfattet:** samarbeidsrommene (`collaborations`) er felles for flere
organisasjoner. Et suspendert fellesskap kan ikke representeres i dem (det er
ikke lenger noen aktive medlemskap å representere fra), men innhold som
allerede er delt der, forblir synlig for de andre deltakerne.

## Forespørsler

`/samarbeid` lagrer en forespørsel i `platform_onboarding_requests` og
ingenting annet: ingen konto, intet fellesskap, ingen e-post. Den går bare
gjennom serveren (`submit_onboarding_request` kan kalles av service-rollen
alene), med et skjult felt for roboter, minstetid på siden, og i databasen:
høyst tre per nettverksadresse i timen (en hash av adressen, slettet etter et
døgn – bare når `TRUSTED_PROXY_COUNT` er satt), én ventende per avsender, og
30 i timen totalt. Alle gyldige innsendinger får samme svar.

Godkjenning oppretter ingenting av seg selv. «Godkjenn og opprett
fellesskap» åpner veiviseren med navnet og kontaktadressen fylt ut;
forespørselen godkjennes og kobles i samme transaksjon som fellesskapet
opprettes. «Godkjenn uten å opprette nå» og «Avslå» registrerer bare
beslutningen. Søkeren får ingen automatisk e-post – svaret sendes manuelt.

Lenken «Samarbeid med TING» på forsiden går fortsatt til e-post
(`app/page.tsx`); den er ikke endret.

## Revisjonsloggen

`platform_audit_log`: hvem (id, adresse og rolle slik de var), hva, mot hva,
når, resultat og korte, ikke-sensitive fakta (felter som er endret, gammel og
ny portaladresse, begrunnelse for suspensjon, invitert adresse). Aldri
passord, tokens, meldinger eller dokumenter.

Registreres: opprettelse, endring, logo, suspensjon, reaktivering,
administratorutnevning/-invitasjon/-fjerning, invitasjon tatt i bruk, sendt på
nytt og trukket tilbake, forespørsel godkjent/avslått/notat, operatør
utnevnt/endret/fjernet, første eier og gjenoppretting. En operatørs avviste
forsøk (validering, konflikt, manglende fersk MFA) registreres som
`failure` av serveren etterpå (`platform_record_failure`).

Loggen kan bare vokse: triggere avviser `UPDATE`, `DELETE` og `TRUNCATE` for
alle, også service-rollen og databaseeieren. Bare en superbruker som først
fjerner triggerne, kan endre historikken.

**Ikke registrert:** forsøk fra kontoer som ikke er operatører (de avvises
før noe skjer, og å logge dem ville latt hvem som helst fylle loggen), og
direkte kall som avvises i databasen før serveren ser dem. Slike avvisninger
står bare i serverens logg.

## Første plattformeier – lokalt

1. Supabase lokalt må ha TOTP på (`[auth.mfa.totp]` i `supabase/config.toml`,
   satt av denne endringen). Etter endring: `npx supabase stop && npx supabase start`.
2. Migrasjonen: `npx supabase migration up --local`.
3. Lag kontoen som vanlig: `/login` → «Logg inn med e-postlenke» (lenken
   kommer i Mailpit, `http://127.0.0.1:54324`), deretter Kontoen din →
   Sikkerhet (`/profile/passord`) og velg passord.
4. Utnevn kontoen fra kommandolinjen:

   ```bash
   npm run platform:owner -- --email deg@eksempel.no            # tørrkjøring
   npm run platform:owner -- --email deg@eksempel.no --confirm
   ```

5. Gå til `/platform-admin`. Første gang: skann QR-koden med en
   autentiseringsapp og skriv inn koden. Deretter ber dashbordet om en kode i
   hver ny økt.

Kommandoen nekter når en aktiv eier finnes – nye eiere utnevnes i dashbordet.

## Gjenoppretting

Har ingen eier tilgang lenger (tapt telefon, sluttet), kjøres dette på
serveren av den som har service-role-nøkkelen:

```bash
npm run platform:owner -- --email ny-eier@eksempel.no --recover --confirm
```

Kontoen må finnes med bekreftet adresse og passord. Det registreres som
`platform_operator.recover` i loggen. Har en eier mistet telefonen, fjernes
den gamle faktoren i Supabase (Authentication → Users → kontoen → MFA), og
personen setter opp en ny ved neste besøk.

## Tester

`npm run check:platform-admin` lager sin egen engangsrollebesetning (kontoer
med passord og TOTP, fellesskap, forespørsler), sjekker alt over som ekte
innloggede kontoer – også direkte mot Supabase og med SQL med falske JWT-er –
og rydder etter seg. Den trenger ingen seed.

Den etterlater linjer i revisjonsloggen, som ikke kan slettes. Kjør den mot en
engangsstakk, ikke mot en database der historikken betyr noe (og aldri mot
produksjon – den nekter `*.supabase.co`). En engangsstakk ved siden av
utviklingsstakken:

```bash
cp -R supabase /tmp/shadow/supabase          # uten .temp
# i /tmp/shadow/supabase/config.toml: project_id = "vevshadow", porter 543xx → 544xx
npx supabase start --workdir /tmp/shadow -x studio,realtime,imgproxy,edge-runtime,logflare,vector,postgres-meta,supavisor
# miljø fra `npx supabase status --workdir /tmp/shadow -o json`:
NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
  SUPABASE_DB_CONTAINER=supabase_db_vevshadow APP_URL=http://localhost:3100 npm run check:platform-admin
```

Sidesjekkene (404 for alle andre, MFA-steget, fjernet tilgang) trenger appen
kjørende mot samme database på `APP_URL`; uten den hoppes de over og står som
hoppet over, ikke bestått.

**Kan ikke verifiseres automatisk:** at den driftede Supabase-plattformen
håndhever TOTP og `amr`-tidspunktene likt som den lokale (samme GoTrue, men
ikke prøvd der); at nginx sender riktig `X-Forwarded-For` (påvirker bare
hastighetsgrensen per adresse på `/samarbeid`); og at e-post faktisk når
fram i produksjon.

## Før produksjon

1. Supabase → Authentication → Multi-Factor: **TOTP på** (enroll og verify).
   Uten det kan ingen operatør komme forbi MFA-steget.
2. Kjør migrasjonen mot det driftede prosjektet (`npx supabase db push`)
   sammen med resten, etter en sikkerhetskopi.
3. Kjør `npm run check:grants` mot en kopi av produksjonsskjemaet (skyggestakk)
   og `npm run check:platform-admin` mot en engangsstakk.
4. Første eier: kontoen opprettes på produksjonssiden, deretter
   `npm run platform:owner -- --email … --confirm` på serveren.
5. Bestem om «Samarbeid med TING» på forsiden skal lenke til `/samarbeid`
   i stedet for e-post.
6. `TRUSTED_PROXY_COUNT=1` bak nginx, ellers gjelder bare grensene per
   avsender og totalt på `/samarbeid`.
7. Avklar hvem som skal være eiere (minst to, så én kan gjenopprette den
   andres tilgang uten servertilgang), og hvor loggen skal leses.
