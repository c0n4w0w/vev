import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { Wordmark } from "@/components/shell/Wordmark";
import { buttonClass } from "@/components/ui/primitives";
import { IconArrowRight, IconLock, IconMail, IconUsers } from "@/components/ui/icons";
import { PUBLIC_HOST } from "@/lib/brand";


/**
 * Public front page.
 *
 * It explains what the platform is, and deliberately does not list a single
 * community. The only way onwards is a portal link you were given, or signing
 * in to an account that already has access.
 */
const principles = [
  {
    icon: IconLock,
    title: "Ingen katalog",
    body: "Det finnes ingen side der du kan bla gjennom organisasjonene på TING. Et slikt register ville i praksis vært en oversikt over hvem som er engasjert i hva.",
  },
  {
    icon: IconMail,
    title: "Tre veier inn",
    body: "Du er allerede medlem, du er invitert av noen som er det, eller du kommer inn gjennom organisasjonens egen offentlige side.",
  },
  {
    icon: IconUsers,
    title: "Én konto, mange rom",
    body: "Du logger inn ett sted og bytter mellom fellesskapene du er med i. Medlemmer i ett rom ser ikke hvilke andre rom du er med i.",
  },
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

      <div className="mx-auto w-full max-w-5xl flex-1 px-5 lg:px-8">
        <section className="grid gap-10 border-b border-line py-16 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16 lg:py-24">
          <div>
            <p className="label">Plattform for private fellesskap</p>
            <h1 className="mt-4 max-w-2xl font-display text-[2.5rem] leading-[1.1] text-ink sm:text-[3.25rem]">
              Et rolig sted for organisasjoner som trenger å snakke sammen.
            </h1>
            <p className="mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-ink-2">
              TING gir foreninger, kollektiver og frivillige organisasjoner et eget rom med
              medlemmer, kanaler, arrangementer og kunngjøringer. Organisasjonen beholder sitt eget
              navn og uttrykk. Plattformen holder seg i bakgrunnen.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={user ? "/home" : "/login"} className={buttonClass()}>
                {user ? "Gå til fellesskapene dine" : "Logg inn"}
                <IconArrowRight size={16} />
              </Link>
            </div>
          </div>

          <aside className="lg:pt-14">
            <div className="rounded-[6px] border border-line bg-surface p-5">
              <p className="label">Slik finner du fram</p>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">
                Har du fått en lenke fra en organisasjon, skriver du den rett inn i adressefeltet:
              </p>
              <p className="mt-3 rounded-[5px] border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink-2">
                {PUBLIC_HOST}/<span className="text-ink">navnet-deres</span>
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
                Vi har ingen søkefunksjon som kan finne den for deg. Det er hele poenget.
              </p>
            </div>
          </aside>
        </section>

        <section className="grid gap-8 border-b border-line py-14 sm:grid-cols-3 sm:gap-10">
          {principles.map((principle) => (
            <div key={principle.title}>
              <principle.icon size={20} className="text-skog" />
              <h2 className="mt-4 font-display text-lg text-ink">{principle.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{principle.body}</p>
            </div>
          ))}
        </section>

      </div>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-6 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <p>TING · prototype</p>
          <p>Ingen data lagres. Ende-til-ende-kryptering er planlagt, men ikke implementert.</p>
        </div>
      </footer>
    </main>
  );
}
