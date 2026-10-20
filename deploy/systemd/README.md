# Planlagt opprydding på serveren (systemd)

Disse enhetene kjører `npm run attachments:sweep` som brukeren `vev` hvert
femte minutt, og sender en e-post til en driftsansvarlig når en kjøring
feiler. De er sjekket inn her, men **ikke installert** på serveren. Dette er
fremgangsmåten når det skal gjøres.

| Fil | Hva den gjør |
| --- | --- |
| `ting-sweep.service` | Én kjøring av oppryddingen, i `/var/www/vev`, som `vev` |
| `ting-sweep.timer` | Starter den hvert femte minutt (og én gang etter oppstart hvis en kjøring ble hoppet over) |
| `ting-sweep-alert.service` | Startes av `OnFailure=` og sender én e-post til `TING_OPS_ALERT_EMAIL`, høyst én i timen |

Hva oppryddingen gjør, står i README under «5. Vedlegg i private samtaler –
drift»: den sletter forsvinnende direktemeldinger som har utløpt (tekst,
vedlegg, varsler), rydder opplastinger som aldri ble sendt, og tømmer
slettekøen i Storage. Den avslutter med feilkode hvis en utløpt melding eller
en fil i køen fortsatt er lagret etterpå — det er det varselet fanger.

Utløpte meldinger er uleselige for alle fra utløpstiden, enten oppryddingen
har kjørt eller ikke. Timeren avgjør bare hvor lenge teksten og filene ligger
lagret etter det: omtrent fem minutter pluss én kjøring.

## Før installasjon

1. **Samme versjon av koden.** Oppryddingen bruker
   `purge_expired_direct_messages()` og må kjøre mot et prosjekt der
   migrasjonene for forsvinnende meldinger er tatt i bruk.
2. **Stien til npm.** Enhetene bruker `/usr/bin/npm`. Sjekk som `vev`:

   ```bash
   sudo -u vev -H bash -lc 'command -v npm'
   ```

   Er den en annen (nvm, `/usr/local/bin`), endre `ExecStart=` i begge
   `.service`-filene til det samme som `vev.service` bruker.
3. **Varseladressen.** Legg til i `/var/www/vev/.env.local`:

   ```bash
   TING_OPS_ALERT_EMAIL=drift@eksempel.no
   ```

   E-posten går ut gjennom TINGs egne SMTP-innstillinger (`EMAIL_PROVIDER=smtp`,
   `SMTP_*`). Prøv dem først med `npm run email:check -- --send-to <adresse>`.
4. **Fjern eventuell crontab-linje** for `attachments:sweep`, så den ikke
   kjører fra to steder. (To samtidige kjøringer er ufarlige — radene låses og
   hoppes over — men det gir dobbel logg.)

## Installasjon (som root)

```bash
install -m 644 /var/www/vev/deploy/systemd/ting-sweep.service       /etc/systemd/system/
install -m 644 /var/www/vev/deploy/systemd/ting-sweep.timer         /etc/systemd/system/
install -m 644 /var/www/vev/deploy/systemd/ting-sweep-alert.service /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/ting-sweep.service /etc/systemd/system/ting-sweep-alert.service
systemctl daemon-reload
```

Kjør én gang for hånd før timeren slås på, og se at den går gjennom:

```bash
systemctl start ting-sweep.service
journalctl -u ting-sweep.service -n 20 --no-pager
```

Siste linje skal begynne med `✓`. Prøv deretter varselet:

```bash
systemctl start ting-sweep-alert.service
journalctl -u ting-sweep-alert.service -n 20 --no-pager
```

Det skal komme én e-post til `TING_OPS_ALERT_EMAIL`. Nullstill så grensen på
én i timen, ellers ville en ekte feil den neste timen ikke gi noe varsel:

```bash
systemctl reset-failed ting-sweep-alert.service
```

Slå så på timeren:

```bash
systemctl enable --now ting-sweep.timer
systemctl list-timers ting-sweep.timer
```

Ingenting her krever at nginx eller `vev.service` startes på nytt.

## Etter hver utrulling

Enhetene leser koden i `/var/www/vev`, så en ny versjon brukes fra neste
kjøring. Er filene i `deploy/systemd/` endret, kopier dem på nytt og kjør
`systemctl daemon-reload`.

## Overvåking

- `journalctl -u ting-sweep.service --since today` — hver kjøring skriver én
  linje med antall slettede meldinger, ryddede opplastinger og fjernede filer.
- `systemctl list-timers ting-sweep.timer` — når den gikk sist og går neste
  gang.
- `systemctl is-failed ting-sweep.service` — `failed` betyr at siste kjøring
  feilet; e-posten skal da ha gått.

Slik slås det av igjen:

```bash
systemctl disable --now ting-sweep.timer
```

## Etter en gjenoppretting av databasen

Timeren er ikke nok alene. Se `docs/ops/post-restore.md`: forsvinnende
meldinger skal slettes **før** appen åpnes igjen.
