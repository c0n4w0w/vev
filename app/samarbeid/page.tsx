import type { Metadata } from "next";
import Link from "next/link";
import { OnboardingRequestForm } from "@/components/platform/OnboardingRequestForm";
import { Wordmark } from "@/components/shell/Wordmark";

export const metadata: Metadata = {
  title: "Samarbeid med TING",
  description: "Fortell oss kort om organisasjonen deres, så tar vi kontakt.",
};

/**
 * Where an organisation asks to join TING. The answer goes to TING's review
 * queue (/platform-admin/foresporsler) and nowhere else; nothing is created
 * until TING approves it and sets the community up.
 */
export default function CollaboratePage() {
  return (
    <main className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center px-5 py-4">
          <Link href="/" aria-label="TING – forsiden">
            <Wordmark />
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <p className="label">Samarbeid</p>
        <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">Vær med å forme TING</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">
          Vi bygger TING sammen med organisasjonene som skal bruke det. Fortell oss kort hvem dere er, så tar vi kontakt. Det
          opprettes ingenting før vi har snakket sammen.
        </p>
        <div className="mt-8 rounded-[8px] border border-line bg-surface p-5 sm:p-7">
          <OnboardingRequestForm />
        </div>
        <p className="mt-6 text-sm text-ink-3">
          Heller e-post? Skriv til{" "}
          <a href="mailto:hei@join-ting.no" className="text-skog underline underline-offset-2">
            hei@join-ting.no
          </a>
          .
        </p>
      </div>
    </main>
  );
}
