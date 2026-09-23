import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Cormorant_Garamond } from "next/font/google";
import { UtrAccessForm } from "@/components/community/UtrAccessForm";
import { Wordmark } from "@/components/shell/Wordmark";
import type { CommunityPublic, Membership, User } from "@/lib/types";
import {
  formatDate,
  formatDateParts,
  formatEventRange,
  formatTime,
  formatWeekday,
} from "@/lib/format";
import styles from "./UtrPortal.module.css";

import liveProjection from "@/public/brand/utr/live-projection.webp";
import eyeProjection from "@/public/brand/utr/eye-projection.webp";
import candleRoom from "@/public/brand/utr/candle-room.webp";
import performerGreen from "@/public/brand/utr/performer-green.webp";

/** The serif undertherug.no itself uses, loaded only for this page. */
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-utr-serif",
  display: "swap",
});

type PublicEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string;
};

const reasons = [
  {
    title: "Oppdag det som skjer mellom de store kveldene.",
    body: "Små konserter, lyttesesjoner, workshops, middager, arbeidsmøter og spontane ting som ikke nødvendigvis havner på den offentlige siden.",
  },
  {
    title: "Finn menneskene bak og rundt UTR.",
    body: "Musikere, kunstnere, designere, teknikere, frivillige og andre nysgjerrige folk i miljøet.",
  },
  {
    title: "Start noe.",
    body: "Del en idé, finn noen å samarbeide med, spør om hjelp eller bli med i et prosjekt som allerede er på vei.",
  },
  {
    title: "Kom nærmere prosessen.",
    body: "Følg ting mens de blir til — nye steder, kunstnere, installasjoner, samarbeid og eksperimenter før de blir ferdige programmer.",
  },
] as const;

const tracked = styles.tracked;
const serif = styles.serif;
const display = `${styles.serif} ${styles.display}`;
const frame = "mx-auto w-full max-w-[84rem] px-5 sm:px-8 lg:px-12";
const sectionHeading = `${serif} text-[clamp(2.25rem,4.4vw,3.75rem)] leading-[1.02]`;
/** Italic serif intro copy, as under the titles on undertherug.no. */
const lede = `${serif} text-[1.25rem] leading-[1.5] italic text-(--utr-ink-2) sm:text-[1.375rem]`;
/** The hero's intro, a step larger than the other ledes. */
const heroLede = `${serif} text-[1.3125rem] leading-[1.5] italic text-(--utr-ink-2) sm:text-[1.4375rem]`;

/** "BLI EN DEL AV FELLESSKAPET →" — the site's own link language. */
function TextLink({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      className={styles.textLink}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <span className={styles.label}>
        {children}{" "}
        <span aria-hidden="true" className={styles.arrow}>
          →
        </span>
        {external ? <span className="sr-only"> (åpnes i ny fane)</span> : null}
      </span>
    </a>
  );
}

/** Three things of the kind that get shared inside, set like Program cards. */
const glimpses = [
  {
    category: "Prosjekter",
    dash: "bg-(--utr-rust)",
    text: "Ser etter noen å bygge en installasjon med til oktober.",
    meta: "Ines · 4 svar",
  },
  {
    category: "Visuelt",
    dash: "bg-[#5d6b93]",
    // Non-breaking hyphen, so the compound never splits across lines.
    text: "João deler visual\u2011systemet fra forrige UTR.",
    meta: "18 filer",
    photo: true,
  },
  {
    category: "Lyttesesjon",
    dash: "bg-(--utr-rust)",
    text: "Listening session torsdag — 12 plasser.",
    meta: "Tors 19.00 · 9 av 12 tatt",
  },
] as const;

/**
 * The Under The Rug portal.
 *
 * Meant to read as another page of undertherug.no that happens to hold a way
 * into the community: the same serif, off-white canvas, tracked metadata, thin
 * rules, pale colour bands and flat photography, with the dark brown kept for
 * the footer. Every other community keeps the default portal in
 * `[portalSlug]/page.tsx`; nothing here changes access policy, invitation
 * handling or what data is public. It only decides how that same data —
 * public events, links, a way in — is shown.
 */
export function UtrPortal({
  community,
  publicEvents,
  user,
  membership,
  pending,
}: {
  community: CommunityPublic;
  publicEvents: PublicEvent[];
  user: User | null;
  membership: Membership | undefined;
  /** The signed-in visitor already has a request waiting. */
  pending: boolean;
}) {
  const isMember = membership?.status === "active";
  const communityHref = `/community/${community.id}`;
  const loginHref = `/login?neste=/${community.slug}`;
  const nextEvent = publicEvents[0];

  return (
    <main
      data-smooth-anchors
      className={`${cormorant.variable} ${styles.root} flex min-h-dvh flex-col`}
    >
      {/* 1 · Header — the mark and one way in. */}
      <header>
        <div className={`${frame} flex items-center justify-between gap-6 py-5 lg:py-7`}>
          <Image
            src="/brand/under-the-rug-logo.png"
            alt="Under The Rug"
            width={96}
            height={96}
            className="h-11 w-11 lg:h-12 lg:w-12"
            preload
          />
          {isMember ? (
            <Link
              href={communityHref}
              className={`${tracked} py-2 underline decoration-(--utr-rule) underline-offset-8 hover:decoration-(--utr-ink)`}
            >
              Åpne fellesskapet
            </Link>
          ) : user ? (
            <span className={`${tracked} text-(--utr-muted)`}>
              Innlogget som {user.name.split(" ")[0]}
            </span>
          ) : (
            <Link
              href={loginHref}
              className={`${tracked} py-2 underline decoration-(--utr-rule) underline-offset-8 transition-colors hover:decoration-(--utr-ink)`}
            >
              Logg inn
            </Link>
          )}
        </div>
      </header>

      {/* 2 · Hero — a page title at full confidence, then copy beside one photograph. */}
      <section className={`${frame} pb-20 pt-10 sm:pt-14 lg:pb-28 lg:pt-14`}>
        <p className={`${tracked} text-(--utr-muted)`}>— Fellesskapet rundt Under The Rug</p>
        <h1
          className={`${display} mt-6 text-[clamp(3rem,7.8vw,7.25rem)] leading-[0.95] lg:mt-8`}
        >
          <span className="block">{"Under\u00a0The\u00a0Rug"} fortsetter</span>
          <em className="block text-balance italic">mellom arrangementene.</em>
        </h1>

        <div className="mt-10 grid gap-12 lg:mt-14 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <div className={`${heroLede} max-w-[30rem] space-y-4`}>
              <p>
                Et digitalt rom for menneskene rundt {"UTR\u00a0—"} kunstnere, musikere,
                frivillige, samarbeidspartnere og folk som bare vil være tettere på det som skjer.
              </p>
              <p>
                Finn mindre arrangementer, nye prosjekter, folk å lage ting med og ting som ennå
                ikke har blitt offentliggjort.
              </p>
            </div>
            <div className="mt-9">
              <TextLink href={isMember ? communityHref : "#tilgang"}>
                {isMember ? "Åpne fellesskapet" : "Bli en del av fellesskapet"}
              </TextLink>
            </div>
            {nextEvent ? (
              <p className={`${tracked} mt-10 border-t border-(--utr-rule) pt-5 text-(--utr-muted)`}>
                Neste åpne kveld
                <a
                  href="#program"
                  className="mt-2 block w-fit text-(--utr-ink) underline decoration-(--utr-rule) underline-offset-4 hover:decoration-(--utr-ink)"
                >
                  {formatDate(nextEvent.startsAt)} · {nextEvent.title}
                </a>
              </p>
            ) : null}
          </div>

          <div className="relative aspect-[4/3] overflow-hidden bg-(--utr-rule) lg:col-span-7 lg:col-start-6">
            <Image
              src={liveProjection}
              alt="To musikere spiller under en stor lerretsprojeksjon i et mørkt industrilokale."
              fill
              preload
              placeholder="blur"
              sizes="(min-width: 1344px) 44rem, (min-width: 1024px) 55vw, 100vw"
              className="object-cover object-[45%_50%]"
            />
          </div>
        </div>
      </section>

      {/* 3 · Akkurat nå — a Program-style band of flat surfaces. */}
      <section aria-labelledby="akkurat-na" className="bg-(--utr-band)">
        <div className={`${frame} py-20 lg:py-28`}>
          <h2 id="akkurat-na" className={sectionHeading}>
            Akkurat nå i
            <br />
            fellesskapet
          </h2>
          <p className={`${serif} mt-3 text-[1.1875rem] italic text-(--utr-ink-2)`}>
            Et lite innblikk i hva som kan dukke opp innenfor.
          </p>
          <p className="mt-4 max-w-md text-[0.9375rem] leading-relaxed text-(--utr-muted)">
            Selve samtalene er bare synlige for folk i fellesskapet.
          </p>

          <ul
            aria-label="Eksempler på oppslag i fellesskapet"
            className="mt-10 grid gap-3 border-t border-(--utr-card-rule) pt-10 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4"
          >
            {glimpses.map((item) => (
              <li
                key={item.category}
                className="flex flex-col border border-(--utr-card-rule) bg-(--utr-card) p-5 lg:p-6"
              >
                <span aria-hidden="true" className={`block h-px w-5 ${item.dash}`} />
                <p className={`${tracked} mt-3 text-(--utr-muted)`}>{item.category}</p>
                {"photo" in item ? (
                  <div className="relative mt-5 aspect-[3/2] overflow-hidden bg-(--utr-night)">
                    <Image
                      src={eyeProjection}
                      alt="Et blått, projisert øye over scenen, med en laserstråle på skrå gjennom rommet."
                      fill
                      placeholder="blur"
                      sizes="(min-width: 1024px) 24vw, (min-width: 640px) 45vw, 100vw"
                      className="object-cover object-[45%_42%]"
                    />
                  </div>
                ) : null}
                <p className={`${serif} mb-8 mt-4 text-balance text-[1.5rem] leading-[1.18]`}>
                  {item.text}
                </p>
                <p className={`${tracked} mt-auto border-t border-(--utr-card-rule) pt-3 text-(--utr-muted)`}>
                  {item.meta}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 4 · Why join — four reasons, set as an index. */}
      <section aria-labelledby="hvorfor" className={`${frame} pb-20 pt-24 lg:pb-28 lg:pt-36`}>
        <p className={`${tracked} text-(--utr-muted)`}>— Hvorfor være med?</p>
        <h2 id="hvorfor" className={`${serif} mt-6 text-[clamp(2.75rem,6.2vw,6rem)] leading-[0.98]`}>
          <span className="block text-balance">Ikke bare følg med.</span>
          <em className="block italic">Ta del.</em>
        </h2>

        <ol className="mt-14 grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:mt-20 lg:gap-x-20 lg:gap-y-16">
          {reasons.map((reason, index) => (
            <li key={reason.title} className="border-t border-(--utr-rule) pt-5">
              <span aria-hidden="true" className={`${tracked} text-(--utr-rust)`}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className={`${serif} mt-4 max-w-md text-balance text-[1.75rem] leading-[1.12]`}>
                {reason.title}
              </h3>
              <p className="mt-3 max-w-md text-[1rem] leading-relaxed text-(--utr-ink-2)">
                {reason.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* 5 · One photograph, set like the Archive — offset, 4:3, nothing on it. */}
      <div className={`${frame} pb-24 lg:pb-36`}>
        <div className="lg:grid lg:grid-cols-12 lg:gap-12">
          <div className="relative aspect-[4/3] overflow-hidden bg-(--utr-rule) lg:col-span-8 lg:col-start-5">
            <Image
              src={candleRoom}
              alt="Et telt, tepper og levende lys på gulvet i et mørkt rom, satt opp for en mindre samling."
              fill
              placeholder="blur"
              sizes="(min-width: 1344px) 52rem, (min-width: 1024px) 64vw, 100vw"
              className="object-cover object-[50%_60%]"
            />
          </div>
        </div>
      </div>

      {/* 6 · Public vs community — one pale band, typography only. */}
      <section aria-labelledby="innenfor" className="bg-(--utr-tint)">
        <div className={`${frame} py-24 lg:py-44`}>
          <h2
            id="innenfor"
            className={`${serif} text-[clamp(2.75rem,6.2vw,6rem)] leading-[1]`}
          >
            <span className="block text-balance">Noe er åpent for alle.</span>
            <em className="block text-balance italic">Resten skjer innenfor.</em>
          </h2>
          <p className="mt-8 max-w-xl text-[1.0625rem] leading-relaxed text-(--utr-ink-2) lg:mt-12">
            På denne siden finner du åpne arrangementer. Inne i fellesskapet finner du samtalene,
            mindre samlinger, prosjektene og menneskene rundt Under The Rug.
          </p>
        </div>
      </section>

      {/* 7 · Public events — a programme list. */}
      <section
        id="program"
        aria-labelledby="apent"
        className={`${frame} scroll-mt-6 pb-20 pt-24 lg:pb-28 lg:pt-32`}
      >
        <p className={`${tracked} text-(--utr-muted)`}>— Åpent for alle</p>
        <h2 id="apent" className={`${sectionHeading} mt-5`}>
          Neste åpne arrangementer
        </h2>

        {publicEvents.length === 0 ? (
          <div className="mt-10 border-t border-(--utr-ink) pt-8">
            <p className={lede}>Ingenting annonsert akkurat nå.</p>
            <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-(--utr-muted)">
              Nye åpne arrangementer dukker opp her så snart de er klare.
            </p>
          </div>
        ) : (
          <ol className="mt-10 border-t border-(--utr-ink) lg:mt-12">
            {publicEvents.map((event) => {
              const date = formatDateParts(event.startsAt);
              return (
                <li
                  key={event.id}
                  className="grid gap-y-4 border-b border-(--utr-rule) py-8 sm:grid-cols-[7.5rem_1fr] sm:gap-x-8 lg:grid-cols-12 lg:gap-x-12 lg:py-10"
                >
                  <p className="flex items-baseline gap-3 sm:row-span-2 sm:block lg:col-span-2 lg:row-span-1">
                    <span className={`${serif} block text-[3.5rem] leading-[0.85] lg:text-[4.5rem]`}>
                      {date.day.replace(".", "")}
                    </span>
                    <span className={`${tracked} ${styles.meta} block text-(--utr-muted) sm:mt-3`}>
                      {date.month} · {date.weekday.slice(0, 3)}
                    </span>
                  </p>
                  <div className="lg:col-span-6">
                    <h3 className={`${serif} text-[1.75rem] leading-[1.1] lg:text-[2.125rem]`}>
                      {event.title}
                    </h3>
                    <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-(--utr-ink-2)">
                      {event.description}
                    </p>
                  </div>
                  <dl className="grid content-start gap-1.5 sm:col-start-2 lg:col-span-4 lg:col-start-auto lg:pt-2 lg:text-right">
                    <dt className="sr-only">Tid</dt>
                    <dd className="text-[1rem] text-(--utr-ink) first-letter:uppercase">
                      {eventTime(event)}
                    </dd>
                    <dt className="sr-only">Sted</dt>
                    <dd className={`${tracked} ${styles.meta} text-(--utr-muted)`}>{event.location}</dd>
                  </dl>
                </li>
              );
            })}
          </ol>
        )}

        {community.links.length > 0 ? (
          <ul className="mt-8 flex flex-wrap gap-x-10 gap-y-2">
            {community.links.map((link) => (
              <li key={link.href}>
                <TextLink href={link.href}>{link.label}</TextLink>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* 8 · The way in — heading and a smaller photograph, beside the invitation. */}
      <section
        id="tilgang"
        aria-labelledby="vaere-med"
        className={`${frame} scroll-mt-6 pb-24 pt-6 lg:pb-36 lg:pt-24`}
      >
        <div className="grid gap-10 border-t border-(--utr-rule) pt-10 lg:grid-cols-12 lg:gap-12 lg:pt-14">
          <div className="lg:col-span-5">
            <h2
              id="vaere-med"
              className={`${serif} text-[clamp(2.75rem,5.6vw,5.25rem)] leading-[0.98]`}
            >
              {isMember ? (
                <>
                  Du er allerede <em className="italic">innenfor.</em>
                </>
              ) : (
                <>
                  Vil du være <em className="italic">med?</em>
                </>
              )}
            </h2>
            <div className="relative mt-12 hidden aspect-[4/3] w-[82%] overflow-hidden bg-(--utr-rule) lg:block">
              <Image
                src={performerGreen}
                alt="En performer bøyer seg over et bord med utstyr foran en grønn projeksjon."
                fill
                placeholder="blur"
                sizes="(min-width: 1344px) 26rem, 32vw"
                className="object-cover object-[35%_50%]"
              />
            </div>
          </div>

          <div className="lg:col-span-6 lg:col-start-7 lg:pt-4">
            {isMember ? (
              <TextLink href={communityHref}>Åpne fellesskapet</TextLink>
            ) : (
              <>
                <div className={`${lede} max-w-[30rem] space-y-4`}>
                  <p>
                    Fellesskapet er for folk som vil være litt tettere på det som skjer rundt Under
                    The Rug.
                  </p>
                  <p>
                    Kunstnere, frivillige, samarbeidspartnere, publikum og andre nysgjerrige folk er
                    velkomne.
                  </p>
                </div>
                <p className="mb-12 mt-6 max-w-md text-[1rem] leading-relaxed text-(--utr-ink-2)">
                  Fortell oss hvem du er, så sender vi deg tilgang.
                </p>
                <UtrAccessForm community={community} signedIn={Boolean(user)} pending={pending} />
              </>
            )}
          </div>
        </div>
      </section>

      {/* 9 · Footer — the one dark band, in undertherug.no's own arrangement. */}
      <footer className="relative mt-auto overflow-hidden bg-(--utr-night) text-(--utr-on-night)">
        <Image
          src="/brand/under-the-rug-globe-mark.png"
          alt=""
          aria-hidden="true"
          width={400}
          height={400}
          className="pointer-events-none absolute -bottom-16 -right-10 hidden h-72 w-72 opacity-[0.07] invert sm:block"
        />
        <div className={`${frame} relative`}>
          <div className="grid gap-10 py-14 sm:grid-cols-3 lg:py-16">
            <div>
              <p className={`${tracked} flex items-center gap-3 text-(--utr-on-night)`}>
                <Image
                  src="/brand/under-the-rug-globe-mark.png"
                  alt=""
                  width={40}
                  height={40}
                  className="h-5 w-5 invert"
                />
                Under The Rug
              </p>
              <p className="mt-4 max-w-[16rem] text-[0.8125rem] leading-relaxed text-(--utr-on-night-2)">
                Fellesskapet rundt Under The Rug. {community.location}, siden{" "}
                {community.foundedYear}.
              </p>
            </div>
            <div>
              <p className={`${tracked} text-(--utr-on-night-2)/70`}>Fellesskapet</p>
              <ul className="mt-4 grid gap-2.5">
                <li>
                  <a
                    href={isMember ? communityHref : "#tilgang"}
                    className={`${tracked} text-(--utr-on-night) hover:text-(--utr-on-night-2)`}
                  >
                    {isMember ? "Åpne fellesskapet" : "Be om tilgang"}
                  </a>
                </li>
                {user ? null : (
                  <li>
                    <Link
                      href={loginHref}
                      className={`${tracked} text-(--utr-on-night) hover:text-(--utr-on-night-2)`}
                    >
                      Logg inn
                    </Link>
                  </li>
                )}
                <li>
                  <a
                    href="#program"
                    className={`${tracked} text-(--utr-on-night) hover:text-(--utr-on-night-2)`}
                  >
                    Åpne arrangementer
                  </a>
                </li>
              </ul>
            </div>
            {community.links.length > 0 ? (
              <div>
                <p className={`${tracked} text-(--utr-on-night-2)/70`}>Under The Rug</p>
                <ul className="mt-4 grid gap-2.5">
                  {community.links.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${tracked} text-(--utr-on-night) hover:text-(--utr-on-night-2)`}
                      >
                        {link.label} <span aria-hidden="true">↗</span>
                        <span className="sr-only"> (åpnes i ny fane)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-(--utr-on-night)/15 py-6">
            <p className={`${tracked} text-(--utr-on-night-2)`}>
              Under The Rug · {community.location} · Norge
            </p>
            <Link
              href="/"
              className={`${tracked} inline-flex items-center gap-2 text-(--utr-on-night-2) transition-colors hover:text-(--utr-on-night)`}
            >
              Drevet av
              <Wordmark className="text-(--utr-on-night)! normal-case tracking-normal" />
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

/**
 * "lørdag 10. oktober, 19.00–01.00". A night that runs past midnight still
 * reads as one evening; anything longer falls back to the full range.
 */
function eventTime(event: PublicEvent) {
  const hours = (Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 3_600_000;
  if (hours > 0 && hours < 14) {
    return `${formatWeekday(event.startsAt)}, ${formatTime(event.startsAt)}–${formatTime(event.endsAt)}`;
  }
  return formatEventRange(event.startsAt, event.endsAt);
}
