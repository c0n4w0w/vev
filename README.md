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
| `SUPABASE_SERVICE_ROLE_KEY` | **Hemmelig.** Går utenom all radsikkerhet. Serverens nøkkel: godkjennings-e-posten, telling av passordforsøk, vedlegg, og skriptene `bootstrap`, `bootstrap:admin`, `attachments:sweep` og `seed` |
| `EMAIL_PROVIDER`, `SMTP_*`, `EMAIL_FROM_*` | Hvordan TINGs egen e-post sendes — se «7. E-post fra TING» |
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

Alle migrasjonene i `supabase/migrations` kjøres i rekkefølge.
`npx supabase db reset` spiller av hele kjeden fra bunnen (lokalt).

Et hostet prosjekt får skjemaet, men ingen fellesskap: de opprettes med
`npm run bootstrap` — se «8. Første installasjon». `npm run seed` er bare for
showcase.

#### Rettigheter: hver tabell må gis til rollene som skal bruke den

Supabase gir ikke lenger nye tabeller i `public` til API-rollene (`anon`,
`authenticated`, `service_role`) av seg selv. Uten en `grant` svarer hver
spørring `42501 permission denied for table`, uansett hva radsikkerheten sier.
`supabase/config.toml` har derfor `auto_expose_new_tables = false`, så den
lokale stakken oppfører seg som den driftede, og
`20261026100000_explicit_api_grants.sql` sier uttrykkelig hva hver rolle har:

| Rolle | Tabeller | Funksjoner |
| --- | --- | --- |
| `anon` | ingen | de sju portalen og invitasjonssiden trenger |
| `authenticated` | `select` der en policy lar et medlem lese; `insert`/`update`/`delete` bare der det finnes en policy for nettopp det | det migrasjonene har gitt, ingenting til alle (`PUBLIC`) |
| `service_role` | lese og skrive, aldri `truncate` | de få serveren kaller |

En migrasjon som lager en tabell, må selv gi den til rollene som skal bruke
den, og en funksjon må si hvem som får kalle den. `npm run check:grants`
sammenligner katalogen med denne tabellen, linje for linje, og prøver reglene
gjennom API-et som anonym, som medlemmer av ulike fellesskap og med serverens
nøkkel — uavhengig av sidene i appen. Legg tabellen til i sjekken når du
legger den til i en migrasjon.

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
| IP Address Forwarding (Rate Limits) | på | Lar grensene telle per medlem i stedet for per server – se «6. Innlogging i produksjon» |

Innstillingene og malene må settes i det driftede prosjektet samtidig som
migreringen kjøres der; ingen av dem følger med koden.

Supabase begrenser selv innlogginger per nettverksadresse (passord og
fornying av sesjon: 150 per 5 minutter, støt på 30; e-postlenker, glemt
passord og endring av passord/e-post: 30 per 5 minutter), men ser TINGs server
som avsender for alle. Derfor forteller appen Supabase hvem som egentlig spør
– se «6. Innlogging i produksjon» under. Tellingen over gjelder uansett.

Supabase sin offentlige nøkkel er offentlig. Den sendes ikke til nettlesere i
dag, men ingen av reglene over hviler på at den er hemmelig.

`npm run check:account-security` prøver alt dette mot den lokale stakken –
også rett mot Supabase Auth, uten TINGs skjemaer. `npm run check:auth-email`
holder e-postmalene like, og `npm run check:auth-forwarding` prøver
adressevideresendingen.

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

**4. Forsvinnende meldinger.** Direktemeldinger med forsvinnende meldinger slått
på blir uleselige for begge i det øyeblikket tiden er ute — det avgjør
databasen selv, uten at noen jobb har kjørt (migrasjonen
`20261107100000_disappearing_direct_messages.sql`). Selve slettingen av tekst,
vedlegg og varsler skjer i `attachments:sweep` (via
`purge_expired_direct_messages()`, bare service-rollen) og når noen åpner
samtalen. Filene går gjennom den samme slettekøen som over.

Ingen planleggerendring er tatt i bruk ennå. Når funksjonen skal ut i
produksjon, bør sweepen gå oftere enn hver time, så utløpt innhold ikke blir
liggende lagret lenger enn nødvendig:

```bash
# crontab: hvert kvarter
*/15 * * * * cd /sti/til/ting && npm run -s attachments:sweep >> /var/log/ting-attachments.log 2>&1
```

Sikkerhetskopier er ikke omfattet: en melding som er slettet her, kan finnes i
en sikkerhetskopi til den kopien utløper etter sin egen oppbevaringstid. Den
tiden må fastsettes og dokumenteres separat.

**Uløst krav – sikkerhetskopier.** Utløpte private meldinger skal ikke kunne
gjenopprettes på ubestemt tid fra historiske sikkerhetskopier. Dette er ikke
løst, og funksjonen skal ikke omtales som «slettet overalt».

- *Bekreftet:* sletting skjer i databasen (tekst, vedlegg, varsler) og i
  fillageret via slettekøen. Repoet inneholder ingen konfigurasjon, kode eller
  dokumentasjon for sikkerhetskopier, og direktemeldinger er ikke
  ende-til-ende-kryptert.
- *Antatt, ikke verifisert:* at Supabases driftede tjeneste tar jevnlige
  sikkerhetskopier (og eventuelt punkt-i-tid-gjenoppretting) av databasen, og
  at disse inneholder utløpte meldinger til de selv utløper. Oppbevaringstid,
  om fillageret dekkes, og hvem som kan gjenopprette, er ikke undersøkt.
- *Anbefalt, egen utredning:* (1) faktisk oppførsel og oppbevaringstid for
  sikkerhetskopier og punkt-i-tid-gjenoppretting hos Supabase; (2) om
  meldingsinnhold kan holdes utenfor ordinære sikkerhetskopier; (3) om
  kryptering med separat forvaltede, slettbare meldingsnøkler er gjennomførbar;
  (4) hvordan vedlegg, varselinnhold og sikkerhetskopier av nøklene da
  håndteres. Ingen produksjonskonfigurasjon endres før dette er avklart.

`npm run check:disappearing-messages` (med appen kjørende lokalt) går gjennom
innstillingen, lesetidspunktet, utløp, opprydding og samspillet med arkiv,
sletting, varsler og vedlegg.

---

### 6. Innlogging i produksjon – adresser og grenser

Alt appen ber Supabase Auth om – innlogging, e-postlenker, fornying av
sesjoner – går ut fra serveren. Uten tiltak ser Supabase én avsender for hele
medlemsmassen, og nok trafikk fra ett sted bruker opp grensen for alle. Lokalt,
mot samme Auth-versjon med grensene slått på, stengte 40 feil innlogginger fra
én adresse ute et medlem med riktig passord på en helt annen.

Løsningen er Supabase sin «IP Address Forwarding»: appen sender medlemmets
egen adresse i `Sb-Forwarded-For`. Supabase tror bare på den når forespørselen
bærer en hemmelig nøkkel (`sb_secret_…`), og den nøkkelen er like mektig som
service-rollen. Derfor:

- De vanlige klientene er uendret: offentlig nøkkel og medlemmets egen sesjon,
  med radsikkerhet som før. Den hemmelige nøkkelen er aldri en klients nøkkel.
- Nøkkelen og adressen settes bare på forespørsler til de Auth-endepunktene
  Supabase begrenser per adresse (`/token`, `/otp`, `/recover`, `/verify` og
  `PUT /user`) – i `lib/supabase/auth-forwarding.ts`. Den følger aldri med en
  spørring mot data-API-et, lagring eller noe annet.
- Adressen er den deres egen proxy har skrevet (`TRUSTED_PROXY_COUNT`). Uten en
  slik sendes ingenting videre.
- Avviser Supabase selve nøkkelen (tilbakekalt, feilskrevet) – et 401-svar
  fra API-porten som sier «API key», ikke et svar fra Auth – sendes
  forespørselen på vanlig måte i stedet og det logges én gang. Da mister man
  grensene per adresse, ikke innloggingen. Ingenting annet sendes to ganger:
  feil passord, utløpt token og «for mange forespørsler» (429) er svar, og gis
  videre som de er.

Uten `SUPABASE_SECRET_KEY` oppfører appen seg som før.

**Prøvd lokalt:** hvilke forespørsler som får nøkkelen og hvilke som aldri får
den; forfalskede `X-Forwarded-For`; manglende og feil proxy-oppsett; avvist
nøkkel; innlogging, fornying, e-postlenke, glemt passord, passordbytte og
utlogging gjennom appen med videresending på, bak en nginx-etterligning; og at
radsikkerheten svarer likt med og uten. **Ikke prøvd, og kan ikke prøves
lokalt:** at den driftede Supabase-plattformen faktisk tar imot nøkkelen på
disse forespørslene og teller per videresendt adresse. Det er punkt 6 under,
og det er en lanseringssperre til det er gjort.

**Sjekkliste**

1. *Hemmelig nøkkel.* Supabase Dashboard → Project Settings → API Keys → lag en
   ny **secret key** bare til dette (f.eks. `ting-auth-forwarding`), så den kan
   byttes uten å røre noe annet. Legg den i serverens miljø som
   `SUPABASE_SECRET_KEY` – i samme fil som `SUPABASE_SERVICE_ROLE_KEY`, lesbar
   bare for brukeren appen kjører som (`chmod 600`). Aldri i repoet, aldri med
   `NEXT_PUBLIC_`-prefiks, aldri i en URL, og ikke lim den inn i chat eller
   saker. Den gamle `service_role`-nøkkelen virker ikke til dette.

2. *Slå på videresending.* Dashboard → Authentication → Rate Limits → **IP
   Address Forwarding** → på. Eller med Management API (tilgangstoken fra
   kontoinnstillingene, ikke en prosjektnøkkel):

   ```bash
   curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"security_sb_forwarded_for_enabled": true}'
   ```

3. *nginx.* Alle `location`-blokker som går til appen, må legge til adressen
   som koblet til – ikke overskrive med noe klienten sendte:

   ```nginx
   location / {
       proxy_pass http://127.0.0.1:3010;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   ```

   `$proxy_add_x_forwarded_for` setter adressen nginx selv så, bakerst; det
   klienten måtte ha skrevet, blir stående foran og leses aldri. Bruker dere
   `real_ip`-modulen eller har noe foran nginx (CDN, lastbalanserer), endrer
   det hva som står bakerst – da må tallet i punkt 5 telles på nytt.

4. *Steng oppstrøms.* Appen må bare være nåbar gjennom nginx, ellers kan hvem
   som helst skrive sin egen `X-Forwarded-For`. Porten (3010 i eksemplene her)
   er ikke satt i dette repoet – `npm start` lytter på 3000 med mindre `PORT`
   eller `-p` sier noe annet – så se etter hva serveren faktisk gjør:

   ```bash
   ss -ltnp | grep -E ':(3000|3010)\b'
   ```

   Adressen skal være `127.0.0.1`, ikke `0.0.0.0` eller `*`. Start med
   `next start -H 127.0.0.1 -p 3010` (eller `HOSTNAME=127.0.0.1 PORT=3010`), og
   la brannmuren avvise porten utenfra uansett. Prøv fra en annen maskin:

   ```bash
   curl -m 5 http://<serverens-adresse>:3010/   # skal ikke få svar
   ```

5. *`TRUSTED_PROXY_COUNT`.* Antall egne proxyer mellom internett og appen: `1`
   bak nginx alene. For lavt tall gir proxyens egen adresse (alle deler grense
   igjen); for høyt gir ingen adresse (ingen videresending). Ingen av delene
   lar en klient velge adresse. Start appen på nytt etter endring. Har
   serveren nøkkelen men ikke dette tallet, logges det én gang ved oppstart.

6. *Prøv det i miljøet det skal kjøre i.* Med en engangskonto, ikke en ekte:
   - Logg inn fra to ulike nett (f.eks. kontor og mobilnett). Under Logs →
     Auth i Supabase skal forespørslene stå med hver sin adresse – ikke
     serverens. Det er beviset på at videresendingen virker.
   - Lag støy fra det ene nettet (feil passord på mange ulike adresser, eller
     «send lenke» mange ganger) til TING eller Supabase svarer med «for mange
     forsøk», og se at innlogging, e-postlenke og vanlig bruk fortsatt virker
     fra det andre.
   - La en økt stå over en time, eller slett tilgangstokenet fra
     informasjonskapselen, og last en side: du skal fortsatt være innlogget
     (fornyingen gikk gjennom), og fornyingen skal stå med din adresse i loggen.
   - Send en forespørsel med `X-Forwarded-For: 1.2.3.4` og se at 1.2.3.4 ikke
     dukker opp i Supabase-loggen.
   - Bytt passord og e-postadresse én gang hver. Det er de to forespørslene
     som bærer både nøkkelen og medlemmets eget token; virker de, er
     kombinasjonen i orden hos Supabase.
   - Se i appens logg etter linjer som begynner med `[auth-forwarding]`. Det
     skal ikke være noen.

7. *Bytte eller trekke tilbake nøkkelen.* Lag en ny secret key → sett den i
   miljøet → start på nytt → gjenta første strekpunkt i punkt 6 → slett så den
   gamle i dashboardet (sletting kan ikke angres). Er en nøkkel på avveie,
   slett den med en gang: appen merker avvisningen, fortsetter uten
   videresending og sier fra i loggen til en ny er på plass. (Hvordan den
   driftede API-porten ordlegger avvisningen, er ikke prøvd; gjør første
   bytte utenom rushtid og se at innlogging virker mens den gamle nøkkelen
   er slettet og den nye ennå ikke er satt.) Fjernes
   `SUPABASE_SECRET_KEY` fra miljøet, er videresendingen av; alt annet virker.
   Bytt også nøkkelen når noen med tilgang til serveren slutter.

### 7. E-post fra TING – SMTP og DNS

TING sender én type e-post selv: velkomsten en administrator utløser med
«Godkjenn» (`lib/email/invitation.ts`). Den går ut over vanlig SMTP
(`lib/email/smtp.ts`) — en vert, en port, en innlogging og en avsender — så
enhver e-posttjeneste som tilbyr SMTP kan brukes, og et bytte er fem
miljøvariabler. Variablene står forklart i `.env.example`.

Innloggingslenker, glemt passord og bytte av e-postadresse sendes ikke herfra.
Dem sender Supabase Auth, med SMTP-innstillingene i Supabase-prosjektet
(Authentication → Emails → SMTP Settings). De to kan bruke samme tjeneste og
samme avsender, men deler ingen innstilling, og begge må settes opp: Supabase
sin innebygde utsending er begrenset til noen få meldinger i timen og er ikke
ment for drift.

**Hva «sendt» betyr.** Administratoren får «sendt» når SMTP-tjeneren har tatt
imot meldingen — ikke før, og det sier ikke at den nådde innboksen. Ellers får
de en av fire beskjeder, og invitasjonen står klar til å sendes på nytt fra
Forespørsler:

| Hva skjedde | Hva TING gjør |
| --- | --- |
| Tjeneren svarte «ikke nå» (4xx), eller var ikke å nå | Ett nytt forsøk med det samme; deretter beskjed om å prøve igjen |
| Tjeneren avviste meldingen eller adressen (5xx) | Ingen nye forsøk; beskjed om å kontrollere adressen |
| Innlogging, kryptering eller avsender ble avvist; oppsett mangler | Ingen forsøk; beskjed om å kontakte den som drifter TING |
| Forbindelsen røk etter at meldingen var påbegynt | Ingen nye forsøk — den kan ha kommet fram; beskjed om å spørre mottakeren |

Det siste er grunnen til at TING ikke prøver på nytt i det uendelige: et nytt
forsøk der kunne gitt samme person to e-poster. Loggen (`[e-post]`) har
feilkoden og mottakerens domene, aldri adressen, lenken eller passordet.

En server som ikke har fått vite hvordan den skal sende (`EMAIL_PROVIDER`
mangler i et produksjonsbygg), sender ingenting og sier det — den skriver ikke
invitasjoner til disk i stedet.

```bash
npm run email:check                            # oppsett, tilkobling, kryptering, innlogging
npm run email:check -- --send-to du@eksempel.no    # … og én testmelding
```

`npm run check:email-smtp` prøver alt dette mot en SMTP-tjener i samme prosess.

#### DNS for avsenderdomenet

For at andres e-posttjenere skal ta imot post fra `ikke-svar@join-ting.no`, må
domenet si at tjenesten dere sender gjennom, har lov. Tre TXT-poster, alle for
**utgående** post:

| Post | Navn | Hva den sier |
| --- | --- | --- |
| **SPF** | `join-ting.no` | Hvilke tjenere som får sende med domenet som avsender. Én post per domene: flere tjenester legges i *samme* post (`v=spf1 include:<tjeneste A> include:<tjeneste B> -all`). `join-ting.no` har i dag `v=spf1 include:spf.webhuset.no -all`; sender dere gjennom noe annet enn Webhuset, må den tjenestens `include` inn der, ellers avvises alt den sender. |
| **DKIM** | `<selector>._domainkey.join-ting.no` | Den offentlige nøkkelen til signaturen e-posttjenesten setter på hver melding. Navn og verdi får dere fra tjenesten (ofte som CNAME). Uten den er meldingen usignert. |
| **DMARC** | `_dmarc.join-ting.no` | Hva mottakere skal gjøre når SPF og DKIM ikke stemmer med avsenderdomenet, og hvor rapporter sendes. Begynn med `v=DMARC1; p=none; rua=mailto:<adresse dere leser>` og stram til `quarantine`/`reject` når rapportene viser at alt ekte passerer. |

Supabase Auth sin e-post bruker samme avsenderdomene og dekkes av de samme
postene, så lenge den sendes gjennom en tjeneste som står i dem.

**MX er noe annet.** MX-poster sier hvor *innkommende* post til `@join-ting.no`
skal leveres. De trengs ikke for å sende. `join-ting.no` har ingen i dag, så et
svar til `ikke-svar@join-ting.no` og en returmelding (bounce) om en adresse som
ikke finnes, har ingen steder å gå — vil dere se returmeldinger, må adressen
kunne ta imot post (MX hos en e-posttjeneste), eller tjenesten må ta dem imot
på et eget returdomene. Enkelte mottakere stoler også mindre på et
avsenderdomene uten MX.

Etter endringene: send en testmelding med `email:check` til en adresse hos en
stor leverandør og se i meldingens hoder at `spf=pass`, `dkim=pass` og
`dmarc=pass`.

### 8. Første installasjon – fellesskap og første administrator

En ny database har skjemaet og ingenting annet. To kommandoer gjør den til en
installasjon, og ingen av dem er `npm run seed`:

```bash
npm run bootstrap                 # tørrkjøring: viser hva som ville blitt opprettet
npm run bootstrap -- --confirm    # oppretter det som mangler
```

`bootstrap` oppretter de tre fellesskapene med identitet, innstillinger og fast
struktur — og ingen kontoer, medlemmer eller innhold. Nøyaktig hva står i
`lib/bootstrap/definition.ts`, som henter det fra de samme filene seeden leser
og lar alt som hører showcasen til, ligge:

| | Tryggere Ruspolitikk | Tryggere Ungdom | Under The Rug |
| --- | --- | --- | --- |
| Slug | `tryggere-ruspolitikk` | `tryggere-ungdom` | `under-the-rug` |
| Språk | bokmål | bokmål | engelsk |
| Profil, tekster, nettsted | ✓ | ✓ | ✓ |
| Medlemsliste / meldinger | bare admin / bare ansvarlige | bare admin / bare ansvarlige | medlemmer / medlemmer |
| Kanaler og kanalseksjoner | ingen | ingen | ingen |
| Lokallag (med hver sin kanal) | 7 | 5 | – |
| Grupper | Safe-Space frivillige | – | – |
| Organisasjonskatalogen | ✓ (uten kontokoblinger) | ikke tatt med | ikke tatt med |

Et fellesskap starter **uten kanaler og uten kanalseksjoner**. Hvordan
samtalene ordnes, bestemmer fellesskapets administratorer selv i appen
(Administrasjon → Kanaler, eller «+» ved Kanaler i sidefeltet). De eneste
kanalene en ny installasjon har, er lokallagenes og gruppenes egne, som
databasen lager for hvert lokallag og hver gruppe.

Den legger til det som mangler og endrer ingenting som finnes: en tekst en
administrator har skrevet om, eller et lokallag som har fått nytt navn, blir
stående, og avviket står i utskriften. En kanal eller seksjon en administrator
har slettet, kommer ikke tilbake — bootstrap oppretter ingen. Den kan derfor kjøres igjen når som
helst, også etter en kjøring som stoppet halvveis. Katalogen for Tryggere
Ungdom og Under The Rug ligger i repoet og tas med ved å legge fellesskapet til
i `DIRECTORY_INCLUDED` og kjøre på nytt.

Noen eldre migrasjoner rettet bare på rader som fantes (språket til Under The
Rug, opplysningene i toppfeltet, Safe-Space-gruppen, to kontaktadresser). Mot
en tom database gjør de ingenting; `bootstrap` oppretter radene med de
verdiene med det samme. `npm run check:bootstrap` holder definisjonen opp mot
seeden: en seedet database skal ikke mangle noe og ikke avvike.

**Første administrator.** Et fellesskap uten medlemmer har ingen som kan
godkjenne det første. Den første administratoren utnevnes derfor av den som
drifter serveren:

```bash
npm run bootstrap:admin -- --community tryggere-ruspolitikk --email navn@eksempel.no            # tørrkjøring
npm run bootstrap:admin -- --community tryggere-ruspolitikk --email navn@eksempel.no --confirm
```

1. Personen går til `/login`, velger «Logg inn med e-postlenke» og logger inn
   med lenken de får. Det oppretter kontoen og bekrefter adressen.
2. Under Kontoen din → Sikkerhet (`/profile/passord`) velger de et passord.
3. Dere kjører kommandoen over.

Kommandoen oppretter ingen konto, setter ikke noe passord, bekrefter ingen
adresse og sender ingenting; mangler ett av stegene, sier den hvilket. Den
nekter hvis fellesskapet allerede har en administrator (det kan bare ha én —
rollen gis videre i appen), og den nekter adressene til showcasens testkontoer.
Ingen administrator står i repoet, i en migrasjon eller i en miljøvariabel.

Rekkefølgen for en ny installasjon: migrasjonene → `npm run bootstrap` →
administratorene oppretter kontoene sine → `npm run bootstrap:admin` for hvert
fellesskap. Alle andre kommer inn gjennom «Be om tilgang» og godkjenning.

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
- **Antall medlemmer lagres ikke, og vises bare til den som kan se
  medlemslisten.** Tallet telles fra de aktive medlemskapene i det øyeblikket
  det vises (`lib/member-count.ts`), og bare for den som
  `can_view_member_directory()` slipper til: administratoren der medlemslisten
  er lukket, alle medlemmer der den er åpen. Andre ser ikke noe tall, den
  offentlige portalen oppgir ingen, og databasen har ingen kolonne å spørre
  etter (`20261027100000`). Tall per lokallag følger sin egen, strengere regel
  (administrator og lokallagsleder). `npm run check:member-count` prøver begge.
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
      kanaler/              Administratorenes kanaler og seksjoner
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
  email/                    TINGs egen e-post: velkomsten, og hvordan den sendes (fil eller SMTP)
  bootstrap/                Hva en ekte installasjon starter med, og første administrator
  mock/                     Innhold til seed-skriptet. Ikke i bruk i appen
supabase/
  migrations/               Skjema, radsikkerhet, funksjoner
scripts/seed.ts             Fyller en showcase-database med testdata
scripts/bootstrap.ts        Oppretter fellesskapene i en ekte installasjon
scripts/bootstrap-admin.ts  Utnevner første administrator
scripts/check-*.ts          Sjekker mot den lokale stakken (`npm run check:<navn>`)
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
