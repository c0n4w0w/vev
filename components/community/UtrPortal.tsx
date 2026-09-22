import Image from "next/image";
import Link from "next/link";
import { PortalAccess } from "@/components/community/PortalAccess";
import { Wordmark } from "@/components/shell/Wordmark";
import { buttonClass } from "@/components/ui/primitives";
import {
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconClock,
  IconFeed,
  IconHash,
  IconLock,
  IconMapPin,
  IconSend,
  IconUsers,
} from "@/components/ui/icons";
import type { CommunityPublic, Membership, User } from "@/lib/types";
import { formatEventRange } from "@/lib/format";
import { PUBLIC_HOST } from "@/lib/brand";

type PublicEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string;
};

const whatsInside = [
  {
    icon: IconFeed,
    title: "Samtaler og oppdateringer",
    body: "Feeden og kanalene der kollektivet snakker sammen mellom arrangementene.",
  },
  {
    icon: IconCalendar,
    title: "Interne arrangementer",
    body: "Vaktlister, produksjonsmøter og samlinger som aldri blir lagt ut offentlig.",
  },
  {
    icon: IconHash,
    title: "Prosjekter og samarbeid",
    body: "Kanaler for det som er i arbeid akkurat nå, og for samtaler med andre vi jobber med.",
  },
  {
    icon: IconUsers,
    title: "Crew og folk i fellesskapet",
    body: "Se hvem som er rundt Under The Rug, hva de holder på med, og finn folk med samme interesser.",
  },
  {
    icon: IconSend,
    title: "Direkte meldinger",
    body: "Ta kontakt med folk i fellesskapet direkte, uten å gå via sosiale medier.",
  },
] as const;

/**
 * The Under The Rug portal.
 *
 * This is the one community whose public page is meant to feel like a direct
 * extension of its own site rather than a shared TING template — an
 * editorial, asymmetrical layout built specifically for it. Every other
 * community keeps the default portal in `[portalSlug]/page.tsx`; nothing here
 * changes access policy, invitation handling or what data is public. It only
 * decides how that same data is presented.
 */
export function UtrPortal({
  community,
  publicEvents,
  user,
  membership,
}: {
  community: CommunityPublic;
  publicEvents: PublicEvent[];
  user: User | null;
  membership: Membership | undefined;
}) {
  const accent = community.branding.accent;
  const isMember = membership?.status === "active";

  const heroCta = isMember
    ? { label: "Åpne fellesskapet", href: `/community/${community.id}` }
    : user
      ? { label: "Be om tilgang", href: "#tilgang" }
      : { label: "Få tilgang til fellesskapet", href: "#tilgang" };

  return (
    <main className="flex min-h-dvh flex-col bg-[#f6f3ee] text-[#221c15]">
      <header className="border-b border-[#e4ddce]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 lg:px-10">
          <Image
            src="/brand/under-the-rug-logo.png"
            alt="Under The Rug"
            width={36}
            height={36}
            className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
            priority
          />
          {isMember ? (
            <Link href={`/community/${community.id}`} className={buttonClass({ size: "sm" })}>
              Åpne fellesskapet
            </Link>
          ) : user ? (
            <span className="text-sm text-[#6b6152]">Innlogget som {user.name.split(" ")[0]}</span>
          ) : (
            <Link
              href={`/login?neste=/${community.slug}`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Logg inn
            </Link>
          )}
        </div>
      </header>

      {/* Hero — the whole point of the first viewport is answered here: what
          this is, why an account is useful, and one way to act on it. */}
      <section className="relative overflow-hidden border-b border-[#e4ddce]">
        <Image
          src="/brand/under-the-rug-globe-mark.png"
          alt=""
          aria-hidden="true"
          width={800}
          height={800}
          className="pointer-events-none absolute -right-24 -top-28 h-[26rem] w-[26rem] opacity-[0.05] sm:h-[34rem] sm:w-[34rem] lg:-right-16 lg:-top-40 lg:h-[46rem] lg:w-[46rem]"
        />
        <div className="relative mx-auto max-w-6xl px-5 py-14 sm:py-20 lg:px-10 lg:py-28">
          <div className="max-w-xl">
            <Image
              src="/brand/under-the-rug-logo.png"
              alt="Under The Rug"
              width={200}
              height={200}
              className="h-16 w-16 sm:h-20 sm:w-20"
              priority
            />
            <h1 className="mt-6 font-display text-[2.25rem] leading-[1.08] text-[#221c15] sm:text-[3.25rem]">
              Fellesskapet fortsetter her.
            </h1>
            <p className="mt-4 max-w-md text-[1.0625rem] leading-relaxed text-[#59503f]">
              Et privat rom for folk rundt Under The Rug — samtaler, arrangementer, prosjekter og
              folk i miljøet rundt kollektivet.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <a
                href={heroCta.href}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[3px] px-6 text-sm font-medium text-white"
                style={{ backgroundColor: accent }}
              >
                {heroCta.label}
                <IconArrowRight size={16} />
              </a>
              {!user ? (
                <span className="text-[13px] text-[#7a7061]">
                  Du logger inn med en TING-konto — samme konto for alle fellesskap du er med i.
                </span>
              ) : null}
            </div>
            <p className="mt-10 text-[13px] text-[#8a8071]">
              Oslo · Siden {community.foundedYear}
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-5 lg:px-10">
        {/* Why join — the value of a TING account, in the community's own terms. */}
        <section className="border-b border-[#e4ddce] py-14 sm:py-16">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-16">
            <div>
              <p className="label text-[#9a5a3c]">Hva du får tilgang til</p>
              <h2 className="mt-3 font-display text-[1.75rem] leading-tight text-[#221c15]">
                Den offentlige siden viser Under The Rug utad. Her samles folk rundt Under The
                Rug.
              </h2>
            </div>
            <ul className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
              {whatsInside.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3.5 border-t border-[#e4ddce] pt-4">
                  <Icon size={18} className="mt-0.5 shrink-0 text-[#9a5a3c]" />
                  <div>
                    <h3 className="text-[0.9375rem] font-medium text-[#221c15]">{title}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-[#6b6152]">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Public vs private — the same distinction the old portal made, said
            more like a person and less like a policy. */}
        <section className="border-b border-[#e4ddce] py-14 sm:py-16">
          <p className="label text-[#9a5a3c]">Åpent utad. Privat der det skal være.</p>
          <div className="mt-6 grid gap-8 sm:grid-cols-2 sm:gap-14">
            <div>
              <h3 className="font-display text-lg text-[#221c15]">Denne siden</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-[#6b6152]">
                Åpne arrangementer og informasjonen Under The Rug selv har valgt å vise fram.
                Alle kan se den, ingen konto trengs.
              </p>
            </div>
            <div>
              <h3 className="font-display text-lg text-[#221c15]">Inne i fellesskapet</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-[#6b6152]">
                Samtaler, interne arrangementer, prosjekter og crew — synlig for folk rundt Under
                The Rug, frivillige og samarbeidspartnere som har fått tilgang.
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-12 py-14 sm:py-16 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
          {/* Public events — supporting content, a preview rather than the point. */}
          <section>
            <p className="label text-[#9a5a3c]">En smakebit</p>
            <h2 className="mt-2 font-display text-xl text-[#221c15]">Åpne arrangementer</h2>
            {publicEvents.length === 0 ? (
              <p className="mt-4 text-[13px] leading-relaxed text-[#6b6152]">
                Ingen åpne arrangementer akkurat nå. Under The Rug legger ut nye her når de er
                klare.
              </p>
            ) : (
              <ul className="mt-5 space-y-6">
                {publicEvents.map((event) => (
                  <li key={event.id} className="border-t border-[#e4ddce] pt-4">
                    <h3 className="font-display text-lg leading-snug text-[#221c15]">
                      {event.title}
                    </h3>
                    <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-[#6b6152]">
                      <IconClock size={14} className="mt-[3px] shrink-0 text-[#9a5a3c]" />
                      <span className="first-letter:uppercase">
                        {formatEventRange(event.startsAt, event.endsAt)}
                      </span>
                    </p>
                    <p className="mt-1 flex items-start gap-1.5 text-[13px] text-[#6b6152]">
                      <IconMapPin size={14} className="mt-[3px] shrink-0 text-[#9a5a3c]" />
                      {event.location}
                    </p>
                    <p className="mt-2.5 text-[13px] leading-relaxed text-[#6b6152]">
                      {event.description}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-5 text-xs leading-relaxed text-[#8a8071]">
              Interne møter, vaktlister og interne arrangementer vises ikke her, og vi oppgir ikke
              hvem i organisasjonen som er vert.
            </p>
          </section>

          {/* Access — same components and rules as every other community's
              portal, just placed inside this layout. */}
          <aside id="tilgang" className="scroll-mt-8 space-y-4 lg:sticky lg:top-8 lg:self-start">
            {isMember ? (
              <div className="border border-[#e4ddce] bg-white/60 p-5">
                <p className="flex items-center gap-2 text-[0.9375rem] font-medium text-[#221c15]">
                  <IconCheck size={17} style={{ color: accent }} />
                  Du er inne i fellesskapet
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-[#6b6152]">
                  Du har tilgang til feed, kanaler, arrangementer og crew og folk i fellesskapet i
                  Under The Rug.
                </p>
                <Link
                  href={`/community/${community.id}`}
                  className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[3px] text-sm font-medium text-white"
                  style={{ backgroundColor: accent }}
                >
                  Åpne fellesskapet
                  <IconArrowRight size={16} />
                </Link>
              </div>
            ) : (
              <PortalAccess
                community={community}
                signedIn={Boolean(user)}
                heading="Vil du inn i fellesskapet?"
                intro={`Ønsker du tilgang til det digitale fellesskapet rundt ${community.name}? Be om tilgang, så tar en administrator stilling til forespørselen.`}
              />
            )}

            {!user ? (
              <div className="border border-[#e4ddce] bg-white/60 p-5">
                <h2 className="text-[0.9375rem] font-medium text-[#221c15]">
                  Har du konto på TING?
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#6b6152]">
                  Samme konto fungerer for alle fellesskap du er med i.
                </p>
                <Link
                  href={`/login?neste=/${community.slug}`}
                  className={`${buttonClass({ variant: "secondary", size: "sm" })} mt-4 w-full`}
                >
                  Logg inn
                </Link>
              </div>
            ) : null}

            <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-[#8a8071]">
              <IconLock size={13} className="mt-px shrink-0" />
              Denne siden er alt offentligheten ser. Folk i fellesskapet, samtaler og interne
              arrangementer ligger bak innlogging.
            </p>
          </aside>
        </div>
      </div>

      <footer className="border-t border-[#e4ddce]">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-6 sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <p className="text-xs text-[#8a8071]">
            Under The Rug · {PUBLIC_HOST}/{community.slug}
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs text-[#8a8071] transition-colors hover:text-[#59503f]"
          >
            Drevet av
            <Wordmark className="scale-90" />
          </Link>
        </div>
      </footer>
    </main>
  );
}
