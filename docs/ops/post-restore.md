# Etter en gjenoppretting av databasen

**Regel:** Etter enhver gjenoppretting av TINGs database — fra en daglig
sikkerhetskopi, til et tidspunkt (PITR), eller til et nytt prosjekt — skal
**alle forsvinnende direktemeldinger som ble skrevet før gjenopprettingspunktet
slettes før appen åpnes igjen**. Deretter kjøres oppryddingen. Først da
startes appen.

Det gjelder også en kopi av produksjonsdatabasen som lastes inn et annet sted
(for feilsøking, en testinstallasjon): den inneholder de samme meldingene.

## Hvorfor

En forsvinnende melding får sin utløpstid fra mottakerens første lesing
(`20261107100000_disappearing_direct_messages.sql`):

| Tilstand | `expires_at` |
| --- | --- |
| ulest | `created_at` + 30 dager |
| lest | `read_at` + valgt varighet (1 time … 4 uker) |

En gjenoppretting til et tidspunkt **før** mottakeren leste meldingen, gir
tilbake raden med `read_at = null`. Utløpstiden blir da `created_at + 30 dager`
igjen, og en melding som allerede hadde forsvunnet — og var slettet av
oppryddingen — blir lesbar for begge på nytt, i opptil 30 dager. Det samme
gjelder meldinger som var lest før gjenopprettingspunktet men utløp etter det:
de kommer tilbake som lesbare til oppryddingen tar dem, og det er bare
oppryddingen som står mellom dem og deltakerne.

Den gjenopprettede databasen kan ikke vite hvilke av dens forsvinnende
meldinger som fortsatt skulle finnes. Derfor slettes alle.

**Hva det koster:** Forsvinnende meldinger som ennå ikke hadde utløpt, går
også tapt. Det er riktig vei å feile: en forsvinnende melding som forsvinner
for tidlig er bedre enn en som kommer tilbake. Vanlige meldinger røres ikke.

## Fremgangsmåte

Skriv ned **gjenopprettingspunktet** (UTC) før du begynner:

- daglig sikkerhetskopi: tidspunktet sikkerhetskopien ble tatt
  (Database → Backups i Supabase viser det);
- punkt-i-tid (PITR): tidspunktet du velger;
- en `pg_dump`-kopi: tidspunktet dumpen ble startet.

Er du i tvil, bruk et senere tidspunkt — men aldri et som ligger etter at
appen ble åpnet igjen.

### 1. Steng appen før gjenopprettingen

På serveren, som root:

```bash
systemctl stop vev.service
```

nginx svarer da `502` for TING. Ingen andre nettsteder på serveren berøres.
`ting-sweep.timer` kan gå videre; den skader ikke noe, og den er med på å
rydde opp etterpå.

### 2. Gjenopprett

I Supabase: Database → Backups (eller Point in Time). Vent til prosjektet er
tilgjengelig igjen.

### 3. Slett forsvinnende meldinger fra før gjenopprettingspunktet

I Supabase SQL Editor (som `postgres`). Se først hvor mange det gjelder:

```sql
select count(*) as meldinger,
       count(*) filter (where read_at is null) as uleste,
       count(*) filter (where expires_at <= now()) as allerede_utlopt
from direct_messages
where disappear_seconds is not null
  and created_at < '2026-10-20T03:00:00Z';   -- gjenopprettingspunktet
```

Slett dem:

```sql
select purge_restored_disappearing_direct_messages('2026-10-20T03:00:00Z');
```

Funksjonen (`20261109100000_restore_purge_disappearing_direct_messages.sql`,
bare service-rollen) returnerer antall slettede meldinger, og skal gi samme tall
som `meldinger` over. Den avviser et tidspunkt i fremtiden. Vedleggene går i
slettekøen `message_attachment_purges`, og varslene som nevner meldingene
slettes med dem.

Kontroller at ingenting er igjen:

```sql
select count(*) from direct_messages
where disappear_seconds is not null
  and created_at < '2026-10-20T03:00:00Z';   -- skal være 0
```

### 4. Kjør oppryddingen

På serveren, som root (eller som `vev` i `/var/www/vev` med
`npm run attachments:sweep`):

```bash
systemctl start ting-sweep.service
journalctl -u ting-sweep.service -n 20 --no-pager
```

Siste linje skal begynne med `✓`. Den fjerner filene i slettekøen fra Storage
og sletter det som ellers er utløpt. Ender den med `✗`, er noe fortsatt lagret:
kjør den igjen, og se på feilmeldingen før du går videre.

### 5. Åpne appen

```bash
systemctl start vev.service
```

## Kjente begrensninger

- **Sikkerhetskopiene selv.** Dette rydder den gjenopprettede databasen, ikke
  sikkerhetskopiene. Slettede meldinger kan ligge i Supabases krypterte
  sikkerhetskopier og PITR-logger til de utløper etter planens
  oppbevaringstid: **[N] dager — ikke bekreftet, må fylles inn**
  (Pro: 7 daglige sikkerhetskopier; PITR 7, 14 eller 28 dager, avhengig av
  tillegget). Samme tall står i grensesnittet (`lib/backup-retention.ts`).
- **Vedlegg.** Ifølge Supabases dokumentasjon omfatter sikkerhetskopiene av
  databasen ikke selve filene i Storage, bare radene som beskriver dem. En fil
  som var slettet før gjenopprettingen, kommer derfor ikke tilbake — men raden
  kan, og den slettes av steg 3. Å fjerne et objekt som ikke finnes er ufarlig.
  Bekreft dette mot prosjektets egen plan før det regnes som sikkert.
- **Annen sletting.** En gjenoppretting bringer også tilbake vanlige meldinger
  som noen hadde slettet selv, og samtaler som begge hadde slettet. Dette
  steget løser ikke det; det gjelder bare forsvinnende meldinger.
- **Det den andre har lagret.** Ingenting her når kopier, skjermbilder eller
  nedlastede filer hos deltakerne.
