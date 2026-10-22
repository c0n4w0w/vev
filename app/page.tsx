import Link from "next/link";
import type { ReactNode } from "react";
import { getSessionUser } from "@/lib/session";
import { Wordmark } from "@/components/shell/Wordmark";
import { cn } from "@/components/ui/primitives";
import { IconArrowRight } from "@/components/ui/icons";
import { RevealObserver } from "@/components/landing/RevealObserver";
import { HeroIllustration } from "@/components/landing/HeroIllustration";
import { CommunitiesIllustration } from "@/components/landing/CommunitiesIllustration";
import { ProductShowcase } from "@/components/landing/ProductShowcase";
import { ControlMockup } from "@/components/landing/ControlMockup";
import { CollaborationDiagram } from "@/components/landing/CollaborationDiagram";
import { NoAdsArt, NotForSaleArt, OwnKeyArt } from "@/components/landing/PrivacyIllustrations";
import {
  AttentionArt,
  ChronoArt,
  CirclesArt,
  FeedbackLoopArt,
  NoProfitArt,
  OpenSourceArt,
  ReinvestArt,
  ShapedArt,
} from "@/components/landing/PhilosophyArt";
import { NowArt, ThenArt } from "@/components/landing/ThingIllustration";
import { GatheringIllustration } from "@/components/landing/GatheringIllustration";
import "@/components/landing/landing.css";

/**
 * Public front page.
 *
 * Six sections: hero, why TING exists, what it stands for, how it is run,
 * the platform itself, and the name with the closing invitation. Each
 * principle is said once, in one place. It lists no communities: the only way onwards is a link you
 * were given, or signing in to an account that already has access.
 *
 * Launch commitments stated on this page that are NOT yet backed by anything
 * public in this repository (check before publishing):
 * - Open source: no public repository or licence exists yet. Copy says the
 *   code is opened "fra lansering" until OPEN_SOURCE_URL is set.
 * - No profit extraction: no legal entity, statutes or profit policy is
 *   documented here.
 * - Shaped by the community: the only feedback channel today is the contact
 *   email; no public feedback process exists.
 */
const CONTACT_EMAIL = "hei@join-ting.no";
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}`;

/** Set to the public repository once it and its licence are published. */
const OPEN_SOURCE_URL: string | null = null;

const cta = {
  primary:
    "l-cta inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-skog px-6 text-[15px] font-medium text-white hover:bg-skog-2",
  secondary:
    "l-cta inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-skog/25 bg-white/70 px-6 text-[15px] font-medium text-skog hover:border-skog/45 hover:bg-white",
};

function Arrow() {
  return <IconArrowRight size={17} className="l-cta-arrow" />;
}

function Eyebrow({
  children,
  tone = "light",
  className,
}: {
  children: ReactNode;
  /** The surface it sits on: dark green text on light, pale sage on dark. */
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 text-[13px] font-semibold tracking-[0.02em]",
        tone === "dark" ? "text-[#dcebdf]" : "text-skog",
        className,
      )}
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current opacity-70" />
      {children}
    </p>
  );
}

const h2 = "text-balance font-display text-[2rem] leading-[1.08] text-ink sm:text-[2.75rem] lg:text-[3.125rem]";
const big =
  "text-balance font-display text-[2.375rem] leading-[1.02] tracking-[-0.02em] text-ink sm:text-[3.5rem] lg:text-[4.25rem]";
const lead = "text-[1.0625rem] leading-relaxed text-ink-2 sm:text-lg";

const principles = [
  {
    title: "Åpen kildekode",
    body: OPEN_SOURCE_URL
      ? "Kildekoden er åpen, så alle kan se hvordan TING fungerer."
      : "Kildekoden blir åpen fra lansering, så alle kan se hvordan TING fungerer.",
    art: <OpenSourceArt />,
    bg: "bg-sky",
  },
  {
    title: "Ingen profittuttak",
    body: "Ingen utbytte til eiere eller investorer.",
    art: <NoProfitArt />,
    bg: "bg-peach",
  },
  {
    title: "Fellesskapet former utviklingen",
    body: "Vi bygger videre ut fra det dere faktisk trenger.",
    art: <ShapedArt />,
    bg: "bg-lavender",
  },
  {
    title: "Organisasjonene har kontrollen",
    body: "Dere bestemmer over medlemmer, roller og regler.",
    art: <OwnKeyArt />,
    bg: "bg-sage",
  },
];

/** What TING will never do with the people in it. */
const refusals = [
  { title: "Ingen annonser", body: "Ingen annonsører å tjene, ingen profilering.", art: <NoAdsArt />, bg: "bg-peach" },
  { title: "Ingen salg av medlemsdata", body: "Medlemslistene er ikke til salgs.", art: <NotForSaleArt />, bg: "bg-sky" },
  {
    title: "Ingen jakt på oppmerksomhet",
    body: "Ingen algoritme rangerer innleggene. Det nyeste vises først.",
    art: <ChronoArt />,
    bg: "bg-sage",
  },
];

export default async function LandingPage() {
  const user = await getSessionUser();
  const appHref = user ? "/home" : "/login";

  return (
    <main className="landing flex min-h-dvh flex-col" data-smooth-anchors>
      <RevealObserver />

      <header className="sticky top-0 z-30 border-b border-line/70 bg-cream/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:h-[76px] sm:px-6 lg:px-8">
          <Link href="/" className="-m-1 rounded-md p-1">
            <Wordmark size="landing" />
          </Link>
          <div className="flex items-center gap-6">
            <nav aria-label="Forsiden" className="hidden items-center gap-6 text-sm text-ink-2 md:flex">
              <a href="#hvorfor" className="transition-colors hover:text-skog">
                Hvorfor TING
              </a>
              <a href="#prinsipper" className="transition-colors hover:text-skog">
                Prinsipper
              </a>
              <a href="#plattformen" className="transition-colors hover:text-skog">
                Plattformen
              </a>
              <a href="#kontakt" className="transition-colors hover:text-skog">
                Kontakt
              </a>
            </nav>
            <Link
              href={appHref}
              className={cn(
                "l-cta inline-flex h-10 items-center rounded-full px-4 text-sm font-medium",
                user ? "bg-skog text-white hover:bg-skog-2" : "border border-skog/25 bg-white/70 text-skog hover:bg-white",
              )}
            >
              {user ? "Fortsett til TING" : "Logg inn"}
            </Link>
          </div>
        </div>
      </header>

      {/* ── 1. Hero ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-cream">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-40 top-24 h-80 w-80 rounded-full bg-peach/40 blur-3xl"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,6fr)_minmax(0,7fr)] lg:gap-6 lg:px-8 lg:pb-24 lg:pt-16">
          <div className="relative">
            <Eyebrow>For organisasjoner og fellesskap</Eyebrow>
            <h1 className="mt-5 text-balance font-display text-[2.625rem] leading-[1.02] tracking-[-0.02em] text-ink min-[400px]:text-[3rem] sm:text-[3.75rem] lg:text-[4.25rem]">
              Fellesskap er ikke en vare.
            </h1>
            <p className={cn(lead, "mt-6 max-w-lg")}>
              TING er en digital møteplass for organisasjoner og fellesskap. Uten annonser og
              profittuttak. Utviklet med dem som bruker den.
            </p>
            <div className="mt-8 flex flex-col gap-3 min-[420px]:flex-row min-[420px]:flex-wrap">
              <Link href={appHref} className={cta.primary}>
                Gå til fellesskapene dine
                <Arrow />
              </Link>
              <a href={CONTACT_HREF} className={cta.secondary}>
                Samarbeid med TING
              </a>
            </div>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-ink-3">
              Har du fått en lenke fra en organisasjon? Åpne den direkte.
            </p>
          </div>
          <div className="relative mx-auto w-full max-w-[560px] lg:max-w-none">
            <HeroIllustration />
          </div>
        </div>
      </section>

      {/* ── 2. Why TING exists ─────────────────────────────────────────── */}
      <section id="hvorfor" className="scroll-mt-20 bg-paper">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div data-reveal="" className="max-w-3xl">
            <Eyebrow>Hvorfor TING?</Eyebrow>
            <h2 className={cn(big, "mt-4")}>Internett skulle bringe oss sammen.</h2>
            <p className={cn(lead, "mt-6 max-w-xl")}>
              I dag er mange av møteplassene våre styrt av selskaper som tjener på oppmerksomheten
              vår. Det finnes en annen måte.
            </p>
          </div>
          <div data-reveal-stagger="" className="mt-12 grid gap-4 sm:mt-16 sm:gap-5 md:grid-cols-2">
            <figure className="overflow-hidden rounded-[28px] bg-[#ebe6dd]">
              <AttentionArt />
              <figcaption className="px-6 pb-6 pt-2">
                <span className="block font-display text-[1.375rem] leading-tight text-ink">
                  Bygget for oppmerksomhet
                </span>
                <span className="mt-1.5 block text-[15px] leading-relaxed text-ink-2">
                  Annonser, endeløse strømmer og algoritmer som konkurrerer om tiden din.
                </span>
              </figcaption>
            </figure>
            <figure data-reveal="" className="overflow-hidden rounded-[28px] bg-[#e3eee6]">
              <CirclesArt />
              <figcaption className="px-6 pb-6 pt-2">
                <span className="block font-display text-[1.375rem] leading-tight text-ink">
                  Bygget for fellesskap
                </span>
                <span className="mt-1.5 block text-[15px] leading-relaxed text-ink-2">
                  Egne rom og egne regler for hvert fellesskap.
                </span>
              </figcaption>
            </figure>
          </div>
          <p
            data-reveal=""
            className="mx-auto mt-14 max-w-3xl text-balance text-center font-display text-[1.75rem] leading-tight text-skog sm:mt-20 sm:text-[2.5rem]"
          >
            Vi mener fellesskap fortjener noe annet.
          </p>
        </div>
      </section>

      {/* ── 3. What TING stands for ────────────────────────────────────── */}
      <section id="prinsipper" className="relative scroll-mt-20 overflow-hidden bg-skog-deep text-cream">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-skog-2/30 blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div data-reveal="" className="max-w-2xl">
            <Eyebrow tone="dark">Prinsipper</Eyebrow>
            <h2 className="mt-4 text-balance font-display text-[2rem] leading-[1.08] text-cream sm:text-[2.75rem] lg:text-[3.125rem]">
              Dette står TING for.
            </h2>
          </div>
          <ul data-reveal-stagger="" className="mt-12 grid gap-4 sm:mt-14 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
            {principles.map((p) => (
              <li key={p.title} className={cn("group l-lift flex flex-col overflow-hidden rounded-[28px] text-ink", p.bg)}>
                <div className="px-3 pt-4">{p.art}</div>
                <div className="flex flex-1 flex-col px-6 pb-7 pt-1">
                  <h3 className="font-display text-[1.375rem] leading-tight">{p.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{p.body}</p>
                  {p.title === "Åpen kildekode" && OPEN_SOURCE_URL ? (
                    <a
                      href={OPEN_SOURCE_URL}
                      className="mt-3 inline-flex min-h-8 items-center gap-1.5 text-sm font-medium text-skog underline underline-offset-4"
                    >
                      Se kildekoden <IconArrowRight size={15} />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <h3 className="mt-16 font-display text-[1.5rem] leading-tight text-cream sm:mt-20 sm:text-[1.875rem]">
            Mennesker er ikke produkter.
          </h3>
          <ul data-reveal-stagger="" className="mt-6 grid gap-4 sm:gap-5 md:grid-cols-3">
            {refusals.map((r) => (
              <li key={r.title} className="group flex items-center gap-4 rounded-[24px] bg-cream/[0.07] p-3 pr-5 ring-1 ring-cream/10">
                <div className={cn("w-28 shrink-0 overflow-hidden rounded-[18px] p-1 sm:w-32", r.bg)}>{r.art}</div>
                <div>
                  <p className="font-display text-[1.1875rem] leading-snug text-cream">{r.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-cream/75">{r.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 4. How TING is run ─────────────────────────────────────────── */}
      <section id="drift" className="scroll-mt-20 bg-paper">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div data-reveal="" className="max-w-2xl">
            <Eyebrow>Slik drives TING</Eyebrow>
            <h2 className={cn(h2, "mt-4")}>Pengene går tilbake. Fellesskapene former veien videre.</h2>
          </div>
          <div className="mt-12 grid gap-4 sm:mt-14 sm:gap-5 lg:grid-cols-2">
            <div data-reveal="" className="flex flex-col rounded-[28px] bg-cream p-6 sm:p-8">
              <div className="mx-auto w-full max-w-[460px]">
                <ReinvestArt />
              </div>
              <h3 className="mt-6 font-display text-[1.5rem] leading-tight text-ink">Ingen utbytte</h3>
              <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">
                Inntektene går til drift og videreutvikling – ikke til eiere eller investorer.
              </p>
            </div>
            <div data-reveal="" className="flex flex-col rounded-[28px] bg-surface p-6 sm:p-8">
              <div className="mx-auto w-full max-w-[500px]">
                <FeedbackLoopArt />
              </div>
              <p className="mt-3 text-center text-xs text-ink-3">
                Bruk → ideer → utvikling → forbedringer → tilbakemelding
              </p>
              <h3 className="mt-6 font-display text-[1.5rem] leading-tight text-ink">Utviklet sammen med dere</h3>
              <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">
                Organisasjonene og menneskene som bruker TING, påvirker hva vi lager videre.{" "}
                <a
                  href={CONTACT_HREF}
                  className="font-medium text-skog underline decoration-skog/30 underline-offset-4 hover:decoration-skog"
                >
                  Har du en idé? Skriv til oss.
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. The platform ────────────────────────────────────────────── */}
      <section id="plattformen" className="scroll-mt-20 bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div data-reveal="" className="mx-auto max-w-2xl text-center">
            <Eyebrow className="justify-center">Plattformen</Eyebrow>
            <h2 className={cn(h2, "mt-4")}>Et eget sted for fellesskapet.</h2>
            <p className={cn(lead, "mx-auto mt-5 max-w-lg")}>
              Samtaler, innlegg, arrangementer og avstemninger – samlet der medlemmene er.
            </p>
          </div>
          <div className="mt-12 sm:mt-16">
            <ProductShowcase />
          </div>

          <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-2">
            <div data-reveal="" className="l-lift rounded-[28px] bg-paper p-6 sm:p-8">
              <h3 className="font-display text-[1.5rem] leading-tight text-ink">Dere styrer rommet</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                Hvem som er med, hvilke roller de har og hvilke kanaler som finnes.
              </p>
              <div className="mt-8 px-2 sm:px-4">
                <ControlMockup />
              </div>
            </div>
            <div data-reveal="" className="l-lift rounded-[28px] bg-paper p-6 sm:p-8">
              <h3 className="font-display text-[1.5rem] leading-tight text-ink">Én konto, flere fellesskap</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                Hvert fellesskap er adskilt, og ingen av dem er søkbare utenfra.
              </p>
              <div className="mx-auto mt-6 max-w-[460px]">
                <CommunitiesIllustration />
              </div>
            </div>
          </div>

          <div className="relative mt-4 overflow-hidden rounded-[28px] bg-skog-deep px-5 py-12 text-cream sm:mt-5 sm:px-10 sm:py-16">
            <div data-reveal="" className="mx-auto max-w-xl text-center">
              <h3 className="text-balance font-display text-[1.75rem] leading-tight text-cream sm:text-[2.25rem]">
                Sammen når det trengs
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-cream/80 sm:text-base">
                Organisasjoner kan samarbeide i et felles rom uten å slå sammen medlemslistene.
              </p>
            </div>
            <div data-reveal="" className="mx-auto mt-10 max-w-[360px] sm:max-w-4xl">
              <CollaborationDiagram />
            </div>
          </div>
        </div>
      </section>

      {/* ── 6. The name, and the invitation ────────────────────────────── */}
      <section id="kontakt" className="scroll-mt-20 overflow-hidden bg-[#eef4ee]">
        <div className="mx-auto max-w-6xl px-4 pt-20 sm:px-6 sm:pt-28 lg:px-8">
          <div data-reveal="" className="grid gap-5 lg:grid-cols-2 lg:items-end lg:gap-16">
            <div>
              <Eyebrow>Navnet</Eyebrow>
              <h2 className={cn(h2, "mt-4")}>Et gammelt ord. En ny møteplass.</h2>
            </div>
            <p className={cn(lead, "max-w-md lg:pb-2")}>
              På norrønt var <i lang="non">þing</i> stedet der folk møttes for å drøfte det som
              angikk dem alle.
            </p>
          </div>
          <div data-reveal-stagger="" className="relative mt-12 grid gap-3 sm:mt-14 sm:grid-cols-2 sm:gap-4">
            <figure className="overflow-hidden rounded-[28px]">
              <ThenArt />
              <figcaption className="bg-[#e6dbc4] px-6 py-4 text-sm text-ink-2">
                <span className="font-display text-lg text-ink">Da</span> · tingstedet
              </figcaption>
            </figure>
            <figure className="overflow-hidden rounded-[28px]">
              <NowArt />
              <figcaption className="bg-[#d3e4d8] px-6 py-4 text-sm text-ink-2">
                <span className="font-display text-lg text-ink">Nå</span> · TING
              </figcaption>
            </figure>
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-[43%] hidden h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-[#eef4ee] bg-skog text-cream sm:inline-flex"
            >
              <IconArrowRight size={18} />
            </span>
          </div>
        </div>

        <div data-reveal="" className="mx-auto max-w-3xl px-4 pt-24 text-center sm:px-6 sm:pt-32">
          <h2 className={big}>Vær med å forme TING.</h2>
          <p className={cn(lead, "mx-auto mt-5 max-w-lg")}>
            Vi bygger TING sammen med organisasjonene som skal bruke det. Fortell oss kort hvem dere
            er.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 min-[420px]:flex-row min-[420px]:items-center">
            <a href={CONTACT_HREF} className={cta.primary}>
              Samarbeid med TING
              <Arrow />
            </a>
            <Link href={appHref} className={cta.secondary}>
              Gå til TING
            </Link>
          </div>
          <a
            href={CONTACT_HREF}
            className="mt-6 inline-flex min-h-11 items-center text-[15px] text-skog underline decoration-skog/30 underline-offset-4 hover:decoration-skog"
          >
            {CONTACT_EMAIL}
          </a>
        </div>
        {/* The ground continues past the drawing's edges on wide screens. */}
        <div className="mt-6 bg-[linear-gradient(to_bottom,transparent_76.9%,#dbe8dc_76.9%,#dbe8dc_90.8%,#b7d0bd_90.8%)] sm:mt-10">
          <div className="mx-auto max-w-6xl">
            <GatheringIllustration />
          </div>
        </div>
      </section>

      <footer className="bg-skog-deep text-cream/75">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-8">
          <div>
            <Wordmark tone="cream" size="landing" />
            <p className="mt-3">En møteplass for fellesskap, ikke for annonsører.</p>
          </div>
          <div className="flex flex-col gap-1 sm:items-end">
            <a href={CONTACT_HREF} className="inline-flex min-h-8 items-center text-cream underline underline-offset-4">
              {CONTACT_EMAIL}
            </a>
            <Link href="/login" className="inline-flex min-h-8 items-center text-cream underline underline-offset-4">
              Logg inn
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
