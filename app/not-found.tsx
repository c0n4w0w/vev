import Link from "next/link";
import { Wordmark } from "@/components/shell/Wordmark";
import { buttonClass } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center px-5 py-4 lg:px-8">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-20 lg:px-8">
        <p className="label">Ikke funnet</p>
        <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink">
          Vi finner ikke denne siden
        </h1>
        <p className="mt-3 max-w-lg text-[0.9375rem] leading-relaxed text-ink-2">
          Adressen kan være feilskrevet, eller så peker den til et fellesskap du ikke har tilgang
          til. Vev viser ikke hvilke fellesskap som finnes, så vi kan dessverre ikke foreslå noe
          liknende.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className={buttonClass({ variant: "secondary" })}>
            Til forsiden
          </Link>
          <Link href="/home" className={buttonClass()}>
            Til fellesskapene mine
          </Link>
        </div>
      </div>
    </main>
  );
}
