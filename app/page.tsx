import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { Wordmark } from "@/components/shell/Wordmark";
import { buttonClass } from "@/components/ui/primitives";
import { IconArrowRight } from "@/components/ui/icons";

/**
 * Public front page.
 *
 * Explains why TING exists and why an organisation can trust it. It lists no
 * communities: the only way onwards is a link you were given, or signing in to
 * an account that already has access.
 */
const CONTACT_EMAIL = "hei@join-ting.no";
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}`;

const principles = [
  {
    title: "Privat som standard",
    body: "Fellesskapene er ikke søkbare eller listet i en offentlig katalog. Du kommer inn gjennom organisasjonen du faktisk er tilknyttet.",
  },
  {
    title: "Ingen annonser. Ingen salg av data.",
    body: "TING er ikke bygget rundt annonsering, profilering eller videresalg av medlemsdata.",
  },
  {
    title: "Organisasjonene har kontrollen",
    body: "Hvert fellesskap bestemmer over medlemmer, roller, innhold og tilgang. Plattformen utvikles og forvaltes med organisasjonene som bruker den.",
  },
];

const how = [
  {
    title: "Eget rom for organisasjonen",
    body: "Egen profil, medlemmer, lokallag, kanaler, arrangementer og intern kommunikasjon.",
  },
  {
    title: "Én konto, flere fellesskap",
    body: "Du kan være med i flere organisasjoner uten at medlemskapene eller medlemslistene blandes sammen.",
  },
  {
    title: "Samarbeid uten å slå sammen organisasjonene",
    body: "Organisasjoner kan opprette private samarbeidsrom på tvers, samtidig som interne medlemslister, roller og fellesskap forblir separate.",
  },
];

const commitments = [
  "Ingen offentlig medlemskatalog",
  "Ingen annonser eller annonseprofilering",
  "Ingen salg av medlemsdata",
  "Tilgang styres av organisasjonen",
];

export default async function LandingPage() {
  const user = await getSessionUser();

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 lg:px-8">
          <Wordmark />
          {user ? (
            <Link href="/home" className={buttonClass({ size: "sm" })}>
              Fortsett til TING
            </Link>
          ) : (
            <Link href="/login" className={buttonClass({ variant: "secondary", size: "sm" })}>
              Logg inn
            </Link>
          )}
        </div>
      </header>

      <div className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-5 lg:px-8">
          <section className="border-b border-line py-14 sm:py-20 lg:py-24">
            <p className="label">Private fellesskap</p>
            <h1 className="mt-4 max-w-3xl text-balance font-display text-[2.125rem] leading-[1.12] text-ink sm:text-[3rem]">
              Private digitale rom for organisasjoner som vil ha kontroll over sitt eget
              fellesskap.
            </h1>
            <p className="mt-6 max-w-2xl text-[1.0625rem] leading-relaxed text-ink-2">
              TING gir foreninger, kollektiver og frivillige organisasjoner et sted for medlemmer,
              samtaler, arrangementer og samarbeid — uten annonser, offentlig medlemskatalog eller
              salg av medlemsdata.
            </p>
            <p className="mt-4 max-w-2xl text-[1.0625rem] leading-relaxed text-ink-2">
              Navnet kommer fra det norrøne <i lang="non">þing</i> — stedet der mennesker møttes for
              å diskutere saker som angikk fellesskapet.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={user ? "/home" : "/login"} className={buttonClass()}>
                {user ? "Gå til fellesskapene dine" : "Logg inn"}
                <IconArrowRight size={16} />
              </Link>
              <a href={CONTACT_HREF} className={buttonClass({ variant: "secondary" })}>
                Samarbeid med TING
                <IconArrowRight size={16} />
              </a>
            </div>
            <p className="mt-6 max-w-xl text-sm leading-relaxed text-ink-3">
              Én TING-konto. Flere separate fellesskap. Organisasjonene beholder kontrollen over
              sine egne rom.
            </p>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-3">
              Har du fått en lenke fra en organisasjon? Åpne den direkte eller logg inn.
            </p>
          </section>

          <section
            aria-label="Prinsipper"
            className="grid gap-8 border-b border-line py-12 sm:grid-cols-3 sm:gap-10 sm:py-14"
          >
            {principles.map((p) => (
              <div key={p.title}>
                <h2 className="label text-skog">{p.title}</h2>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{p.body}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-6 border-b border-line py-14 sm:py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
            <div>
              <p className="label">Hvorfor TING?</p>
              <h2 className="mt-4 text-balance font-display text-[1.75rem] leading-[1.15] text-ink sm:text-[2.25rem]">
                Et gammelt ord for å møtes om det som angår oss.
              </h2>
            </div>
            <div className="max-w-xl space-y-4 text-[1.0625rem] leading-relaxed text-ink-2">
              <p>
                På norrønt var <i lang="non">þing</i> en forsamling: et sted der mennesker møttes
                for å drøfte felles saker og ta beslutninger. TING låner navnet, ikke formen. I dag
                er møteplassen digital — men behovet er fortsatt det samme: et rom der et
                fellesskap kan snakke sammen på sine egne premisser.
              </p>
              <p>
                Derfor er TING bygget rundt avgrensede fellesskap, ikke en offentlig strøm.
                Organisasjonen styrer hvem som kommer inn, hvilke rom som finnes og hvordan de
                brukes.
              </p>
            </div>
          </section>

          <section className="border-b border-line py-14 sm:py-20">
            <p className="label">Slik fungerer TING</p>
            <div className="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-10">
              {how.map((item, i) => (
                <div key={item.title} className="border-t border-line-2 pt-4">
                  <p className="font-mono text-xs text-ink-3">0{i + 1}</p>
                  <h3 className="mt-3 font-display text-lg leading-snug text-ink">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-2">{item.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-2 lg:gap-16">
              <div>
                <p className="font-display text-xl leading-snug text-ink">
                  Noen ganger trenger flere organisasjoner et felles bord.
                </p>
                <p className="mt-3 max-w-md text-[0.9375rem] leading-relaxed text-ink-2">
                  TING lar organisasjoner opprette private samarbeidsrom uten å slå sammen
                  medlemslister eller åpne sine interne fellesskap for hverandre.
                </p>
              </div>
              <p className="border-l-2 border-skog pl-4 text-[0.9375rem] leading-relaxed text-ink-2">
                Hvert fellesskap har egne medlemmer, roller og tilgangsregler. At to organisasjoner
                bruker TING betyr ikke at de kan se hverandres medlemslister eller interne innhold.
              </p>
            </div>
          </section>
        </div>

        <section className="border-b border-line bg-skog-soft">
          <div className="mx-auto grid max-w-5xl gap-8 px-5 py-14 sm:py-20 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16 lg:px-8">
            <div>
              <h2 className="text-balance font-display text-[1.75rem] leading-[1.15] text-ink sm:text-[2.25rem]">
                Teknologi skal tjene fellesskapet — ikke omvendt.
              </h2>
              <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-ink-2">
                TING bygges som langsiktig digital infrastruktur for medlemsorganisasjoner og
                kollektiver. Målet er et system uten annonsemodell, uten salg av medlemsdata og uten
                behov for å gjøre private fellesskap til offentlige sosiale nettverk.
              </p>
              <p className="mt-4 max-w-xl text-[1.0625rem] leading-relaxed text-ink-2">
                TING utvikles og forvaltes sammen med organisasjonene og kollektivene som bruker
                plattformen — infrastruktur de kan være med på å forme, ikke en plattform som lever
                av oppmerksomheten deres.
              </p>
            </div>
            <div className="lg:pt-2">
              <ul className="divide-y divide-line-2 border-y border-line-2">
                {commitments.map((c) => (
                  <li key={c} className="py-3 text-[0.9375rem] text-ink">
                    {c}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-sm leading-relaxed text-ink-2">
                Et ting var ikke et publikum man sendte innhold til, men et sted man møttes. TING er
                bygget med den samme forskjellen i tankene.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-16 sm:py-24 lg:px-8">
          <h2 className="max-w-2xl text-balance font-display text-[1.75rem] leading-[1.15] text-ink sm:text-[2.25rem]">
            Vil organisasjonen din bruke eller utvikle TING sammen med oss?
          </h2>
          <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-ink-2">
            Vi ønsker å samarbeide med foreninger, kollektiver og frivillige organisasjoner som
            trenger et privat digitalt rom — eller som vil være med på å forme hvordan TING
            utvikles videre.
          </p>
          <p className="mt-3 text-sm text-ink-3">Fortell kort hvem dere er og hva dere trenger.</p>
          <a
            href={CONTACT_HREF}
            className="mt-6 inline-flex min-h-11 items-center gap-2 font-display text-xl text-skog underline decoration-line-2 underline-offset-4 hover:decoration-skog sm:text-2xl"
          >
            {CONTACT_EMAIL}
            <IconArrowRight size={18} />
          </a>
          <p className="mt-10 text-sm text-ink-3">
            Et sted å møtes. Der organisasjonen selv setter rammene.
          </p>
        </section>
      </div>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-8 text-sm text-ink-3 sm:flex-row sm:items-start sm:justify-between lg:px-8">
          <div>
            <Wordmark />
            <p className="mt-2">Private digitale rom for organisasjoner og kollektiver.</p>
          </div>
          <div className="flex flex-col gap-1 sm:items-end">
            <a href={CONTACT_HREF} className="text-ink-2 underline underline-offset-4">
              {CONTACT_EMAIL}
            </a>
            <Link href="/login" className="text-ink-2 underline underline-offset-4">
              Logg inn
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
