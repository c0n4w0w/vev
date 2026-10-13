# TING

En plattform for private fellesskap: **én konto, flere organisasjoner**.

Foreninger, kollektiver og frivillige organisasjoner får hvert sitt lukkede rom
med medlemmer, kanaler, feed, arrangementer og kunngjøringer. Plattformen leverer
infrastrukturen; organisasjonen beholder sin egen identitet.

Frontend er Next.js (App Router) og data ligger i Supabase.

---

## Kom i gang

Appen trenger et Supabase-prosjekt. Uten miljøvariabler starter den, men hver
side svarer med en feilmelding som sier hva som mangler.

### 1. Miljøvariabler

```bash
cp .env.example .env.local
```

Fyll inn fra Supabase (Project settings → API), eller fra utskriften til
`npx supabase start` hvis du kjører lokalt:

| Variabel | Hva det er |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Prosjektets URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Offentlig nøkkel, trygg i nettleseren |
| `SUPABASE_SERVICE_ROLE_KEY` | **Hemmelig.** Går utenom all radsikkerhet. Brukes kun av `npm run seed` |
| `TING_MODE` | Sett til `demo` for en showcase-utrulling. Ubrukt (produksjon) er standard |
| `TRUSTED_PROXY_COUNT` | Antall egne proxyer foran appen (`1` bak nginx). Lar passordforsøk begrenses per nettverksadresse — se «Innlogging, passord og e-postadresse» |
| `DEMO_TOKEN_TRYGGERE`, `DEMO_TOKEN_UTR` | Én uttrekkbar lenke per showcase — se «Showcase-innlogging» under |

### 2. Skjema

**Lokalt** (anbefalt under utvikling). Krever en container-runtime. Docker
Desktop fungerer; `colima` er lettere og trenger ikke administratorpassord:

```bash
brew install colima docker
colima start --cpu 2 --memory 4 --disk 20
npx supabase start
```

`npx supabase start` skriver ut URL-en og nøklene du trenger i `.env.local`.
`analytics` og `edge_runtime` er slått av i `supabase/config.toml` — de brukes
ikke, og de er de tyngste containerne å laste ned.

**Mot et hostet prosjekt** i stedet:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Fem migrasjoner kjøres: tabellene og radsikkerheten, portal- og
medlemskapsfunksjonene, og deretter tre rettelser (se `supabase/migrations`).
`npx supabase db reset` spiller av hele kjeden fra bunnen.

### 2b. Typer

`lib/supabase/database.types.ts` er generert fra skjemaet. Kjør dette etter
hver migrasjon, ellers oppdager ikke TypeScript at en kolonne er endret:

```bash
npx supabase gen types typescript --local > lib/supabase/database.types.ts
```

Radaliasene nederst i fila (`CommunityRow`, `PortalEventRow`, …) er avledet av
den genererte `Database`-typen, så en kolonne som forsvinner gir en typefeil i
`lib/data.ts` i stedet for `undefined` på skjermen.

### 3. Testdata

```bash
npm run seed
```

Oppretter 16 kontoer, tre fellesskap, kanaler, innlegg, meldinger,
arrangementer og varsler. Skriptet kan kjøres på nytt — det tømmer
innholdstabellene først og gjenbruker kontoer som allerede finnes.

### 4. Kjør

```bash
npm run dev
```

Man logger inn med e-postadresse og passord, eller med engangslenke på e-post.
Begge veier går til samme konto. Testkontoene fra `npm run seed` har ikke
passord; de kommer inn med lenke (alle e-poster lander i Mailpit lokalt,
`http://127.0.0.1:54324`) og kan opprette passord under Kontoen din → Sikkerhet.

#### Innlogging, passord og e-postadresse

Supabase Auth lagrer og kontrollerer passordene. TING har ingen egen
passordtabell, og ingen innlogging via Google, Apple eller andre tredjeparter.

| Hva | Hvor | Hvordan |
| --- | --- | --- |
| Logge inn | `/login` | E-post og passord; «Logg inn med e-postlenke» er alternativet |
| Nytt medlem | `/opprett-passord` | Etter innlogging fra godkjennings-e-posten, **før** medlemskapet aktiveres. Lenken i e-posten fører tilbake hit til invitasjonen utløper |
| Eksisterende medlem | `/profile/passord` | Oppretter passord, eller endrer det med det nåværende |
| Glemt passord | `/glemt-passord` → `/nytt-passord` | Lenke på e-post; brukes først når skjemaet sendes |
| Bytte e-postadresse | `/profile/e-post` → `/bekreft-e-post` | Passord + bekreftelse fra den **nye** adressen. Den gamle trengs ikke |

Reglene som betyr noe, håndheves i databasen
(`supabase/migrations/20261025100000_account_security.sql`), ikke bare i appen:

- Ingen konto opprettes med passord, og et passord som finnes når adressen
  bekreftes første gang, forkastes. Ellers kunne hvem som helst registrere seg
  oppå en adresse og beholde en nøkkel til kontoen eieren senere tar i bruk.
- Et medlemskap aktiveres ikke før kontoen har et passord. En godkjenning
  aktiverer bare en konto som allerede har et (`approve_access_request`);
  alle andre – ny, ubekreftet, eller bekreftet og vant til e-postlenke – får
  invitasjonen, som venter på passordet (`accept_invitation_token`). Det
  finnes derfor ingen tilgang å bruke i mellomtiden – verken via sidene,
  server actions eller Supabase direkte. En konto som har passord, blir aldri
  bedt om et nytt, heller ikke i neste fellesskap.
- Et eksisterende passord kan bare byttes av en sesjon som nettopp har bevist
  det nåværende passordet, eller som nettopp kom fra en lenke på e-post
  («Glemt passord»). En sesjon alene – for eksempel en stjålet – kan ikke.
- Et e-postbytte kan bare fullføres til en adresse eieren har autorisert med
  en sesjon som nettopp har bevist passordet (som må være minst 24 timer
  gammelt), og bare mens eieren er innlogget og trykker på knappen den nye
  adressen fikk tilsendt. Verken en sesjon alene eller lenken alene endrer noe.
- Passordforsøk telles i databasen før Supabase blir spurt: per konto (fem
  forsøk, så ventetid som dobles fra 30 sekunder til 15 minutter) og per
  nettverksadresse (20 feil, så 15 minutter). Innlogging med e-postlenke
  påvirkes ikke, så den som blir stengt ute av andres gjetting, kommer inn.

**Nettverksadressen** leses bare fra den delen av `X-Forwarded-For` som
deres egen proxy har skrevet. Sett `TRUSTED_PROXY_COUNT=1` bak nginx (som må
ha `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`), og la appen
bare være nåbar gjennom proxyen. Uten variabelen stoles det ikke på noen
adresse, og bare grensen per konto gjelder.

**Auth-innstillinger som må stå slik** (lokalt i `supabase/config.toml`; i det
driftede prosjektet under Authentication i Supabase):

| Innstilling | Verdi | Hvorfor |
| --- | --- | --- |
| Confirm email | på | Ellers gir registrering oppå en adresse en sesjon uten at innboksen er vist fram |
| Secure email change | **av** | Den gamle innboksen skal ikke være et krav. Databasereglene over erstatter den |
| Secure password change | på | En sesjon eldre enn et døgn kan ikke sette passord alene |
| Require current password | på | Supabase sjekker også selv det nåværende passordet. Unntar sesjoner som startet med e-postlenke – databaseregelen over dekker dem |
| Minimum password length | 12 | Samme grense som `lib/password.ts` |
| Leaked password protection | på, der planen har det | Avviser passord fra kjente lekkasjer |
| Maler: Reset password, Change email address | `supabase/templates/` | Lenkene går til TINGs egne sider med `token_hash` |
| Varsler: Password changed, Email address changed | på, med TING-malene | Eieren får vite om endringer i ettertid |
| Site URL | nettstedets adresse | Malene bygger lenkene sine fra den |

Supabase begrenser selv innlogginger per nettverksadresse (passord: 150 per
5 minutter, støt på 30), men ser TINGs server som avsender for alle. Tellingen
over er det som skiller folk fra hverandre. «IP Address Forwarding» i Supabase
(krever en `sb_secret_`-nøkkel) retter dette også hos dem; det er ikke koblet
til ennå.

**Før lansering – ikke testet ennå, og skal ikke regnes som løst:**

- *IP Address Forwarding hos Supabase.* Uten den deler alle medlemmer TINGs
  serveradresse hos Supabase Auth, så nok trafikk fra ett sted kan bruke opp
  grensen for innlogging, e-postlenker og fornying av sesjoner for alle.
  Krever en `sb_secret_`-nøkkel og at appen sender `Sb-Forwarded-For`; det er
  ikke bygget, fordi det ikke kan prøves lokalt.
- *Grensene bak nginx.* At `TRUSTED_PROXY_COUNT=1` gir riktig adresse i den
  faktiske kjeden, og at Supabase sine grenser slår inn som ventet, må prøves
  i miljøet det skal kjøre i.
- *Innstillingene og malene i tabellen over* må settes i det driftede
  prosjektet sammen med migreringen.

Supabase sin offentlige nøkkel er offentlig. Den sendes ikke til nettlesere i
dag, men ingen av reglene over hviler på at den er hemmelig.

`npm run check:account-security` prøver alt dette mot den lokale stakken –
også rett mot Supabase Auth, uten TINGs skjemaer – og `npm run
check:auth-email` holder e-postmalene like.

#### Showcase-innlogging (`/demo/<token>`)

Den tiltenkte veien inn i en showcase-utrulling. Krever `TING_MODE=demo` og en
`DEMO_TOKEN_*`-verdi (se tabellen over) — ingen passord, ingen e-post, ingen
konto å opprette. Lenken logger besøkende rett inn som showcasens person og
sender dem til fellesskapet showcasen handler om. `npm run seed` oppretter
disse kontoene uten passord; det er ikke nødvendig for denne veien inn.

En feil eller manglende token svarer alltid 404, og på en utrulling der
`TING_MODE` ikke er `demo` — altså produksjon — svarer den 404 uansett hva
token er, selv om en gyldig verdi skulle stå i miljøet.

### 5. Vedlegg i private samtaler – drift

Filer kan legges ved i private grupper, private lokallagskanaler og direkte
meldinger (`supabase/migrations/20261024100000_message_attachments.sql`). De
ligger i den private bøtta `message-attachments` og leveres bare gjennom
`/community/<id>/attachments/<id>`, som sjekker tilgangen på nytt ved hver
forespørsel. Det finnes ingen offentlige eller signerte lenker.

Tre ting må være på plass der appen kjører. Ingen av dem settes opp av koden.

**1. Proxyen foran appen må slippe gjennom 25 MB.** nginx stopper som standard
alt over 1 MB med `413`, lenge før appen ser forespørselen. Opplastingen går til
én bestemt adresse, så grensen kan heves bare der:

```nginx
# Opplasting av vedlegg: 25 MiB fil + litt til multipart-innpakningen.
location ~ ^/community/[^/]+/attachments/upload$ {
    client_max_body_size 26m;
    proxy_request_buffering off;   # la appen avvise før hele fila er lest
    proxy_read_timeout 120s;
    proxy_pass http://127.0.0.1:3010;   # samme upstream og headere som ellers
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Resten av nettstedet kan beholde sin lave grense. Selve appen har ingen egen
grense på denne ruta (den er unntatt fra `proxy.ts`, som ellers bufrer
forespørsler opp til 10 MB), men avviser alt over samtalens grense med `413`.
En plattform med lavere tak på forespørsler enn dette — serverløse funksjoner
med 4,5 MB, for eksempel — kan ikke ta imot store vedlegg.

**2. Supabase-prosjektet må tillate 25 MB per fil.** Bøtta settes til 25 MiB av
migrasjonen, men prosjektets globale grense (Storage → Settings → «Upload file
size limit») gjelder over den. Standard er 50 MB, så dette er vanligvis i orden.

**3. Opprydding på en klokke.** Appen rydder selv mens den er i bruk: etter en
opplasting, når noen fjerner en fil før sending, og når en gruppe eller privat
kanal slettes. For at en stille periode ikke skal la filer bli liggende, kjør
i tillegg dette jevnlig (krever `SUPABASE_SERVICE_ROLE_KEY`):

```bash
# crontab: hver time, logg til fil
17 * * * * cd /sti/til/ting && npm run -s attachments:sweep >> /var/log/ting-attachments.log 2>&1
```

Den fjerner opplastinger som aldri ble sendt (eldre enn 24 timer) og filer som
står i slettekøen `message_attachment_purges`. Køen er fasiten på hva som
skal bort: en rad forsvinner derfra først når Storage har bekreftet slettingen,
så en feil gjør bare at fila prøves igjen ved neste kjøring. Skriptet avslutter
med feilkode og skriver antall og alder på eldste rad hvis noe fortsatt står
igjen — det, og linjer merket `[attachments]` i appens logg, er det som skal
overvåkes. En fil som venter i køen er allerede uleselig for alle.

`npm run check:attachments` (med appen kjørende lokalt) går gjennom hele
tilgangsmodellen, grensene og oppryddingen mot ekte innloggede kontoer.

---

## Fellesskapene

Tre organisasjoner brukes som utstillingsvindu. De deler plattform og
ingenting annet: egne medlemmer, roller, kanaler, arrangementer og profil.

| Fellesskap | Portal | Hva det er |
| --- | --- | --- |
| Tryggere Ruspolitikk | `/tryggere-ruspolitikk` | Medlemsorganisasjon. Politikk, kampanjer, prosjekter, frivillighet og arrangementer |
| Tryggere Ungdom | `/tryggere-ungdom` | Ungdomsorganisasjonen til Tryggere Ruspolitikk. Aktiviteter, kurs, prosjekter og frivillighet |
| Under The Rug | `/under-the-rug` | Uavhengig kulturkollektiv. Rave, arrangementer, nattliv og fellesskap |

**Tryggere Ruspolitikk og Tryggere Ungdom hører sammen** — den ene er
ungdomsorganisasjonen til den andre, og innholdet deres sier det.

**Under The Rug er en helt uavhengig organisasjon** uten noen tilknytning til
noen av dem. Den er med fordi den tok i bruk TING tidlig. Ingenting i innholdet
skal antyde noe annet, og `scripts/check-content.ts` håndhever det.

En konto tilhører personen, ikke organisasjonen. Ingrid er administrator i den
ene, moderator i den andre og vanlig medlem i den tredje — rollene følger
fellesskapet, ikke brukeren.

---

## Språk

Grensesnittet finnes på norsk bokmål (`nb`) og engelsk (`en`). Hvert fellesskap
har et standardspråk i `communities.default_locale` (begrenset til de to; ikke
fritekst): Tryggere Ruspolitikk og Tryggere Ungdom er `nb`, Under The Rug er `en`.

- Ordbøkene ligger i `lib/i18n/nb/` (kilden — nøklene defineres her) og
  `lib/i18n/en/`. `en` er typet mot `nb`, så en manglende oversettelse er en
  typefeil.
- Serverkomponenter bruker `communityLocale(community)` og `translator(locale)`;
  klientkomponenter bruker `useT()` / `useLocale()`. `AppShell` legger språket i
  en `LocaleProvider` ut fra hvilket fellesskap ruten tilhører, så språket
  skifter ved vanlig navigasjon.
- Språk er presentasjon, ikke tilgang: ingen policy eller funksjon leser det.
- Bare grensesnittet oversettes. Innlegg, biografier, meldinger, kanalnavn og
  arrangementstekster vises nøyaktig slik noen skrev dem.
- Kontonivå-sidene (hjem, mine fellesskap, varsler, profil) er norske foreløpig.
  `resolveLocale({ user, community })` er skjøten der en brukerpreferanse kan
  komme inn senere: eksplisitt valg → fellesskapets standard → plattformens (`nb`).

Å legge til et språk: en ordbok, en oppføring i `LOCALES`, og en utvidelse av
sjekken `communities_default_locale_allowed`.

---

## Personvernmodellen

Dette er den viktigste designbeslutningen i produktet, og den er nå håndhevet i
databasen — ikke bare i applikasjonskoden.

- **Det finnes ingen katalog.** `communities` kan bare leses av noen som allerede
  har en rad i `memberships` for akkurat det fellesskapet. Det finnes ingen
  spørring som returnerer «alle fellesskap», heller ikke for en innlogget bruker.
- **Portalene går utenom tabellen.** `/under-the-rug` og de andre hentes med
  databasefunksjonen `portal_by_slug(slug)`, som tar én nøyaktig slug og
  returnerer én rad. En lenke virker; API-et kan ikke vandres.
- **Portalen viser bare det som er publisert.** Funksjonen returnerer ikke
  `about` (den interne beskrivelsen), og `portal_events` returnerer ikke
  `host_id` — å navngi hvem i en organisasjon som er vert ville røpe den
  personens medlemskap til enhver besøkende.
- **Profiler er ikke søkbare.** Du ser deg selv, folk du deler et fellesskap med,
  og den som eventuelt inviterte deg. Ikke mer.
- **Medlemskap endres bare gjennom databasefunksjoner.** `memberships` har ingen
  insert-, update- eller delete-policy i det hele tatt. Overgangene
  (`request_community_access`, `approve_access_request`,
  `reject_access_request`, `accept_invitation_token`) sjekker sine egne
  forutsetninger, så reglene holder uansett hva som kaller dem.
- **En innlogget ikke-medlem som prøver `/community/<id>`** blir sendt til
  fellesskapets offentlige portal — vi bekrefter ikke at det private rommet
  finnes. Finnes det ingen portal å sende dem til, blir det 404.

---

## Struktur

```
app/
  page.tsx                  Offentlig forside (ingen katalog)
  login/                    E-post og passord, eller engangslenke på e-post
  glemt-passord/ nytt-passord/   Be om og bruke lenke for nytt passord
  opprett-passord/          Passordsteget etter en godtatt invitasjon
  bekreft-e-post/           Bekreftelse av ny e-postadresse
  auth/callback/            Veksler innloggingskoden mot en sesjon
  actions.ts                Server actions: innlogging, invitasjoner, tilgang
  account-actions.ts        Server actions: passord og e-postadresse
  (app)/                    Alt bak innlogging — deler navigasjonsskallet
    home/ communities/ events/ notifications/ profile/
    community/[communityId]/
      layout.tsx            Tilgangssjekk for hele fellesskapet
      page.tsx              Oversikt
      feed/ announcements/ events/ members/
      channel/[channelId]/  Kanal og samtale
  (portal)/[portalSlug]/    Offentlig portal per organisasjon
proxy.ts                    Fornyer Supabase-sesjonen (het middleware før v16)
components/
  ui/                       Ikoner og primitiver
  shell/                    Navigasjonsskall, sidefelt, fellesskapsbytter
  community/                Innleggskort, arrangementskort, kanalvisning
lib/
  types.ts                  Domenemodellen. CommunityPublic vs Community skiller
                            det offentlige fra det interne i typene selv
  data.ts                   Eneste skjøt mot databasen
  session.ts                Innlogget konto
  account-security.ts       Passord og e-postbytte, alt via Supabase Auth
  password.ts               Passordregelen (lengde), uten database
  roles.ts                  Rolledefinisjoner (brukes også av klientkomponenter)
  format.ts                 Dato- og tidsformatering (følger språket)
  i18n/                     Språk: ordbøker (nb, en), t()/tn(), useT()
  supabase/                 Klienter, miljøvariabler, databasetyper
  mock/                     Innhold til seed-skriptet. Ikke i bruk i appen
supabase/
  migrations/               Skjema, radsikkerhet, funksjoner
scripts/seed.ts             Fyller databasen
```

---

## Sjekkliste for verifisering

Etter `npm run seed`, gå gjennom dette i nettleseren. Alt sto på grønt i
prototypen før migreringen; dette bekrefter at radsikkerheten oppfører seg likt.

**Uten innlogging**

1. `/tryggere-ruspolitikk`, `/tryggere-ungdom` og `/under-the-rug` viser hver
   sin beskrivelse og sine åpne arrangementer, men ingen personnavn.
2. Skjemaet «Be om tilgang» er utilgjengelig til du logger inn.
3. `/community/under-the-rug` sender deg til `/login`.
4. `/finnes-ikke` gir 404.

**Som showcase-personaene** — gå inn via `/demo/<token>`, se
«Showcase-innlogging» over. Tokenet ligger i miljøet, ikke her.

5. Tryggere-lenken logger deg inn som **Kari Moen** og lander på Tryggere
   Ruspolitikk. Bytteren viser hennes to fellesskap — Tryggere Ruspolitikk og
   Tryggere Ungdom — og ingenting fra Under The Rug.
6. `/notifications` viser fire varsler, tre uleste: to forespørsler om tilgang
   fra fellesskapet hun administrerer, og kunngjøringer fra begge. Klikk på ett
   → det ene merkes som lest, telleren i sidefeltet går ned, og lenken lander
   der varselet peker.
7. UTR-lenken logger deg inn som **Robin Sæther** og lander på Under The Rug.
   Bytteren har bare det ene fellesskapet, og varslene hans er bare derfra.

**Som Sofie (kaldstart: ingen fellesskap, ingen medlemskapsrad)**

8. `/home` og `/communities` viser tom tilstand — ingen katalog, ingen
   invitasjon liggende.
9. `/community/tryggere-ungdom` sender deg til den offentlige portalen. Det
   private rommet bekreftes ikke.
10. Portalen tilbyr «Be om tilgang» → «Forespørselen er sendt». Svaret er det
    samme uansett hva databasen fant.

**Som Ingrid (administrator i Tryggere Ruspolitikk, moderator i Tryggere Ungdom,
medlem i Under The Rug)**

11. `/community/tryggere-ruspolitikk/requests` viser køen med Godkjenn/Avslå.
    Den ligger under Forespørsler i sidefeltet, og bare for administratorer.
12. Godkjenn → TING sender en invitasjon på e-post. Personen blir medlem først
    når lenken tas i bruk, og får varselet «Du er nå medlem av …» da.
13. Avslå → raden forsvinner, og søkeren får beskjed hvis adressen hører til en
    konto.
14. `/community/tryggere-ungdom/requests` sier «Kun for administratorer» —
    moderator er ikke administrator.
15. `/community/under-the-rug/members` har **ingen** admin-knapper — der er hun
    bare medlem.

**I databasen** (`psql` mot prosjektet, eller SQL Editor)

```sql
-- Som anonym: ingen katalog, men portalene svarer.
set role anon;
select count(*) from communities;                        -- 0 rader
select name from portal_by_slug('tryggere-ungdom');      -- Tryggere Ungdom
select count(*) from portal_events('tryggere-ungdom');   -- kun offentlige, uten vert
reset role;
```

---

## Hva som gjenstår

- **Skriving er fortsatt lokal.** Innleggsskjemaet og kanalfeltet oppdaterer bare
  komponenttilstand. Radsikkerheten for innsending finnes (`posts_insert`,
  `messages_insert`, inkludert at kunngjøringer krever moderator), men skjemaene
  er ikke koblet til den ennå.
- **`mark_notifications_read()`** ligger klar i databasen, men ingenting kaller
  den — å markere alt som lest ved besøk er en produktbeslutning, ikke en del av
  datamigreringen.
- **Sanntid.** `ChannelView` rendrer fra en enkel meldingsliste. Et Supabase
  realtime-abonnement kobles på der uten å røre presentasjonen.
- **Ende-til-ende-kryptering.** `messages.body` er eneste sted klartekst vises.
- **Kommentartråder.** Innlegg viser `comment_count`, men det finnes ingen tråd.
