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
| `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` | `true` slår på demokontoene på innloggingssiden |
| `DEMO_ACCOUNT_PASSWORD` | Passordet seed-skriptet gir demokontoene |

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

Med `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true` kan du logge inn som:

| Konto | Tilgang | Viser |
| --- | --- | --- |
| Ingrid Hovden | 3 fellesskap (admin, moderator, medlem) | Multi-fellesskap på tvers av to uavhengige organisasjoner, og adminverktøy |
| Jonas Aalborg | 1 fellesskap (Under The Rug) | Produktet med bare én organisasjon |
| Sofie Lind | 0 fellesskap, 1 invitasjon til Tryggere Ungdom | Tom tilstand og veien inn via en portal |

Uten demomodus logger man inn med engangslenke på e-post.

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
  (`request_access`, `accept_invitation`, `decline_invitation`,
  `approve_membership`, `reject_membership`) sjekker sine egne forutsetninger, så
  reglene holder uansett hva som kaller dem.
- **En innlogget ikke-medlem som prøver `/community/<id>`** blir sendt til
  portalen hvis de har en invitasjon eller en søknad liggende, og får ellers 404
  — vi bekrefter ikke at rommet finnes.

---

## Struktur

```
app/
  page.tsx                  Offentlig forside (ingen katalog)
  login/                    Engangslenke på e-post, og demokontoer i demomodus
  auth/callback/            Veksler innloggingskoden mot en sesjon
  actions.ts                Server actions: innlogging, invitasjoner, tilgang
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
  roles.ts                  Rolledefinisjoner (brukes også av klientkomponenter)
  format.ts                 Norsk dato- og tidsformatering
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

**Som Sofie (ingen fellesskap, én invitasjon)**

5. `/home` viser tom tilstand og invitasjonen til Tryggere Ungdom.
6. `/community/tryggere-ungdom` sender deg til portalen — invitasjon er ikke tilgang.
7. Portalen viser «Du er invitert», med hvem som inviterte.
8. «Nei takk» → invitasjonen forsvinner fra hjem, sidefelt og varsler blir lest.
9. Portalen tilbyr nå «Be om tilgang» i stedet.
10. Send en søknad til `/tryggere-ruspolitikk` → «Forespørselen er sendt», og
    `/communities` viser «Venter på svar» uten å legge den i Mine fellesskap.
11. Ta imot invitasjonen på nytt (kjør seed igjen) → du havner rett inn i
    fellesskapet, står i medlemslisten merket «Deg».

**Som Ingrid (administrator i Tryggere Ruspolitikk, moderator i Tryggere Ungdom,
medlem i Under The Rug)**

12. `/community/tryggere-ruspolitikk/members` viser ventende søknader med
    Godkjenn/Avslå.
13. Godkjenn → personen flyttes til medlemslisten og får varselet «Du har fått
    tilgang til …».
14. Avslå → raden forsvinner. Seksjonen skjules når køen er tom.
15. `/community/tryggere-ungdom/members` viser ingen Godkjenn/Avslå — moderator
    er ikke administrator.
16. `/community/under-the-rug/members` har **ingen** admin-knapper — der er hun
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
