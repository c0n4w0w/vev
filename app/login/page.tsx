import type { Metadata } from "next";
import Link from "next/link";
import { sendMagicLink, signInAsDemoUser } from "@/app/actions";
import { Wordmark } from "@/components/shell/Wordmark";
import { Button, Panel, buttonClass, cn } from "@/components/ui/primitives";
import { IconArrowRight, IconLock, IconMail } from "@/components/ui/icons";
import { demoAccounts } from "@/lib/demo-accounts";
import { getSessionUser } from "@/lib/session";
import { demoLoginEnabled } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Logg inn" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const current = await getSessionUser();
  const nextPath = typeof params.neste === "string" ? params.neste : "/home";
  const sentTo = typeof params.sendt === "string" ? params.sendt : undefined;
  const error = typeof params.feil === "string" ? params.feil : undefined;

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 lg:px-8">
          <Link href="/">
            <Wordmark />
          </Link>
          {current ? (
            <Link href="/home" className="text-sm text-ink-2 transition-colors hover:text-ink">
              Fortsett som {current.name.split(" ")[0]}
            </Link>
          ) : null}
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 lg:px-8 lg:py-20">
        <p className="label">Logg inn</p>
        <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">
          Velkommen tilbake
        </h1>
        <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">
          Vi sender deg en lenke på e-post. Ingen passord å huske, og ingenting å miste hvis noen
          skulle få tak i maskinen din.
        </p>

        {sentTo ? (
          <Panel className="mt-8 flex items-start gap-3 p-5">
            <IconMail size={18} className="mt-0.5 shrink-0 text-skog" />
            <div>
              <h2 className="text-[0.9375rem] font-medium text-ink">Sjekk e-posten din</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                Hvis <span className="text-ink">{sentTo}</span> har en konto hos oss, ligger det nå
                en innloggingslenke der. Lenken varer i én time.
              </p>
            </div>
          </Panel>
        ) : (
          <Panel className="mt-8 p-5 sm:p-6">
            <form action={sendMagicLink} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <input type="hidden" name="next" value={nextPath} />
              <div className="flex-1">
                <label htmlFor="email" className="label">
                  E-postadresse
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="navn@organisasjon.no"
                  className="mt-2 h-11 w-full rounded-[5px] border border-line-2 bg-surface px-3 text-[0.9375rem] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink-3"
                />
              </div>
              <Button type="submit" size="lg" className="shrink-0">
                Send lenke
                <IconArrowRight size={16} />
              </Button>
            </form>
            {error ? (
              <p className="mt-3 text-[13px] text-rust">Noe gikk galt: {error}</p>
            ) : null}
          </Panel>
        )}

        {demoLoginEnabled() ? (
          <section className="mt-12">
            <div className="rounded-[6px] border border-dashed border-line-2 p-5 sm:p-6">
              <p className="label">Kun i denne prototypen</p>
              <h2 className="mt-3 font-display text-xl text-ink">Demokontoer</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">
                Tre konteer med ulik tilgang, så du ser hvordan plattformen oppfører seg for folk
                med ingen, ett og flere fellesskap. De finnes bare når databasen er fylt med
                testdata, og knappene er slått av i et ekte oppsett.
              </p>

              <div className="mt-5 space-y-3">
                {demoAccounts.map((account) => (
                  <Panel key={account.email}>
                    <form action={signInAsDemoUser}>
                      <input type="hidden" name="email" value={account.email} />
                      <input type="hidden" name="next" value={nextPath} />
                      <button
                        type="submit"
                        className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-paper-2/60"
                      >
                        <span
                          className={cn(
                            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-paper-2 text-xs font-semibold text-ink-2",
                          )}
                        >
                          {account.initials}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-display text-lg text-ink">
                            {account.name}
                          </span>
                          <span className="mt-1 block text-[13px] leading-relaxed text-ink-2">
                            {account.summary}
                          </span>
                          <span className="mt-1.5 block text-xs text-ink-3">{account.access}</span>
                        </span>
                        <IconArrowRight size={18} className="shrink-0 text-ink-3" />
                      </button>
                    </form>
                  </Panel>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <div className="mt-10 flex flex-col gap-4 rounded-[6px] border border-line bg-surface p-5 sm:flex-row sm:items-start">
          <IconLock size={18} className="mt-0.5 shrink-0 text-skog" />
          <div>
            <h2 className="text-[0.9375rem] font-medium text-ink">Har du fått en invitasjon?</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              Invitasjoner peker rett til organisasjonens egen side, for eksempel
              vev.no/tryggere-ruspolitikk. Logg inn først, så tar lenken deg videre dit.
            </p>
            <Link href="/" className={`${buttonClass({ variant: "secondary", size: "sm" })} mt-4`}>
              Tilbake til forsiden
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
