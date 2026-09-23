import Image from "next/image";
import Link from "next/link";
import { TryggereAccessForm } from "@/components/community/TryggereAccessForm";
import { RotatingHeadlineWord } from "@/components/community/RotatingHeadlineWord";
import { Wordmark } from "@/components/shell/Wordmark";
import { buttonClass } from "@/components/ui/primitives";
import {
  IconArrowRight,
  IconCheck,
  IconClock,
  IconExternal,
  IconFeed,
  IconHash,
  IconLock,
  IconMapPin,
  IconSend,
  IconUsers,
} from "@/components/ui/icons";
import type { CommunityPublic, Membership, User } from "@/lib/types";
import type { TryggerePortalBrand } from "@/lib/tryggere-portal";
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

/**
 * Everything below the hero is the same for every organisation that uses this
 * portal. It is written about the digital community, not about the
 * organisation: the people arriving here mostly belong to the organisation
 * already, and what they need to know is what the community is for.
 *
 * Only functionality that exists is described. Lokallag, Organisasjonen,
 * feed/kanaler and direct messages all live inside the community; none of
 * their content is fetched or shown on this public page.
 */
const localGroupPoints = [
  "Knytt deltakelsen din til lokallaget ditt",
  "Se innlegg fra lokallaget",
  "Finn arrangementer som er relevante der du er",
  "Fortsett å delta i resten av organisasjonen",
] as const;

const localGroupPreview = [
  { title: "Neste aktivitet", body: "Lokale arrangementer for lokallaget ditt." },
  { title: "Fra lokallaget", body: "Innlegg som er skrevet for lokallaget ditt." },
  { title: "Kontakt", body: "Kontaktpersonen for lokallaget, når lokallaget har en." },
] as const;

const communityValue = [
  {
    icon: IconFeed,
    title: "Del og hold deg oppdatert",
    body: "Feed, kunngjøringer og kanaler gjør det lettere å holde informasjon samlet mellom møter og aktiviteter.",
  },
  {
    icon: IconUsers,
    title: "Folk i organisasjonen",
    body: "Finn ansatte, sentralstyret, lokallagsledere og kontaktinformasjonen deres, samlet under Organisasjonen.",
  },
  {
    icon: IconHash,
    title: "Prosjekter og samarbeid",
    body: "Bruk prosjektkanaler til arbeid som går på tvers av lokallag og resten av organisasjonen.",
  },
  {
    icon: IconSend,
    title: "Direkte meldinger",
    body: "Ta kontakt med relevante personer direkte i fellesskapet.",
  },
] as const;

// Restrained, cool civic palette. The organisation's own accent is the only
// saturated colour on the page; everything else is ink and hairlines. The
// section bands alternate as white / tint / white / tint / stronger tint /
// paper, with each tint derived from the accent so both portals stay on-brand.
const ink = "text-[#14212e]";
const ink2 = "text-[#46525f]";
const ink3 = "text-[#5f6b77]";
const rule = "border-[#dde3e9]";

/**
 * The public portal for the Tryggere organisations.
 *
 * One implementation serves both Foreningen Tryggere Ruspolitikk and Tryggere
 * Ungdom. Logo, name, accent, places, links and events come from the community
 * record and `lib/tryggere-portal.ts`; the composition and the copy are
 * shared on purpose, because the proposition is the same — see the note above
 * `localGroupPoints`.
 */
export function TryggerePortal({
  community,
  brand,
  publicEvents,
  user,
  membership,
  pending,
}: {
  community: CommunityPublic;
  brand: TryggerePortalBrand;
  publicEvents: PublicEvent[];
  user: User | null;
  membership: Membership | undefined;
  /** The signed-in visitor already has a request waiting. */
  pending: boolean;
}) {
  const accent = community.branding.accent;
  const isMember = membership?.status === "active";
  const communityHref = `/community/${community.id}`;

  return (
    <main className="flex min-h-dvh flex-col bg-white text-[#14212e]">
      <header className={`border-b ${rule}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 lg:px-10">
          <span className="label">Digitalt fellesskap</span>
          {isMember ? (
            <Link href={communityHref} className={buttonClass({ size: "sm" })}>
              Åpne fellesskapet
            </Link>
          ) : user ? (
            <span className={`text-sm ${ink2}`}>Innlogget som {user.name.split(" ")[0]}</span>
          ) : (
            <Link
              href={`/login?neste=/${community.slug}`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Logg inn
            </Link>
          )}
        </div>
        <div className="h-[3px]" style={{ backgroundColor: accent }} aria-hidden="true" />
      </header>

      {/* Hero — organisation, reason, one way in. */}
      <section className={`border-b ${rule}`} style={{ backgroundColor: `${accent}0d` }}>
        <div className="mx-auto max-w-6xl px-5 py-12 sm:py-20 lg:px-10 lg:py-24">
          <div className="max-w-2xl">
            <Image
              src={brand.logo.src}
              alt={community.name}
              width={brand.logo.width}
              height={brand.logo.height}
              className="h-11 w-auto sm:h-14"
              priority
            />
            <h1
              className={`mt-8 font-display text-[2.375rem] leading-[1.06] sm:mt-10 sm:text-[3.5rem] ${ink}`}
            >
              Hele organisasjonen, samlet på ett sted.
            </h1>
            <p className={`mt-5 max-w-xl text-[1.0625rem] leading-relaxed ${ink2}`}>
              Hold kontakten med lokallaget ditt, få med deg det som skjer, del informasjon og snakk
              med andre i organisasjonen.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              {isMember ? (
                <Link
                  href={communityHref}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[3px] px-6 text-sm font-medium text-white"
                  style={{ backgroundColor: accent }}
                >
                  Åpne fellesskapet
                  <IconArrowRight size={16} />
                </Link>
              ) : (
                <a
                  href="#tilgang"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[3px] px-6 text-sm font-medium text-white"
                  style={{ backgroundColor: accent }}
                >
                  Få tilgang
                  <IconArrowRight size={16} />
                </a>
              )}
              {!user ? (
                <Link
                  href={`/login?neste=/${community.slug}`}
                  className={`text-sm font-medium underline decoration-[#b9c3cd] underline-offset-4 transition-colors hover:decoration-current ${ink}`}
                >
                  Logg inn
                </Link>
              ) : null}
            </div>
            <p className={`mt-4 text-[13px] leading-relaxed ${ink3}`}>
              Du bruker samme TING-konto i alle fellesskap du har tilgang til.
            </p>
          </div>
        </div>
      </section>

      {/* Lokallag — the strongest reason to use the community. The panel on the
          right describes what opens up after access; it shows no group data. */}
      <section className={`border-b ${rule}`} style={{ backgroundColor: `${accent}1a` }}>
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-20 lg:px-10">
          <div>
            <p className="label" style={{ color: accent }}>
              Lokallaget ditt
            </p>
            <h2 className={`mt-3 max-w-lg font-display text-[1.875rem] leading-[1.12] sm:text-[2.5rem] ${ink}`}>
              Lokallaget ditt, med hele organisasjonen rundt.
            </h2>
            <p className={`mt-4 max-w-lg text-base leading-relaxed ${ink2}`}>
              Hold kontakten lokalt, se hva som skjer og finn relevante arrangementer og samtaler
              der du er. Velger du lokallag i fellesskapet, samles det lokale på ett sted.
            </p>
            <ul className="mt-7 max-w-lg space-y-3">
              {localGroupPoints.map((point) => (
                <li key={point} className={`flex items-start gap-3 text-[0.9375rem] ${ink}`}>
                  <IconCheck size={17} className="mt-0.5 shrink-0" style={{ color: accent }} />
                  {point}
                </li>
              ))}
            </ul>
            <p className={`mt-6 max-w-lg text-[13px] leading-relaxed ${ink3}`}>
              Å velge lokallag er frivillig. Du har tilgang til hele fellesskapet uansett.
            </p>
          </div>

          <div
            className={`self-start border ${rule} bg-white`}
            role="group"
            aria-label="Slik ser lokallaget ut inne i fellesskapet"
          >
            <div className={`flex items-center gap-3 border-b ${rule} px-5 py-4`}>
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px]"
                style={{ backgroundColor: `${accent}14`, color: accent }}
              >
                <IconMapPin size={18} />
              </span>
              <div>
                <p className={`text-[12px] ${ink3}`}>Mitt lokallag</p>
                <p className={`font-display text-[1.125rem] leading-tight ${ink}`}>
                  Alt fra lokallaget ditt
                </p>
              </div>
            </div>
            <ul>
              {localGroupPreview.map((row) => (
                <li key={row.title} className={`border-b ${rule} px-5 py-4`}>
                  <p className={`text-[0.9375rem] font-medium ${ink}`}>{row.title}</p>
                  <p className={`mt-0.5 text-[13px] leading-relaxed ${ink2}`}>{row.body}</p>
                </li>
              ))}
            </ul>
            <div className="px-5 py-4">
              <p className={`text-[0.9375rem] font-medium ${ink}`}>Resten av organisasjonen</p>
              <p className={`mt-0.5 text-[13px] leading-relaxed ${ink2}`}>
                Feed, kanaler og folk på tvers av lokallagene.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* The rest of what the community is for. */}
      <section className={`border-b ${rule}`}>
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20 lg:px-10">
          <div className="max-w-xl">
            <p className="label" style={{ color: accent }}>
              Hvorfor et digitalt fellesskap
            </p>
            <h2 className={`mt-3 font-display text-[1.875rem] leading-[1.12] sm:text-[2.25rem] ${ink}`}>
              Et sted for organisasjonen mellom <RotatingHeadlineWord />
            </h2>
          </div>
          <ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {communityValue.map(({ icon: Icon, title, body }) => (
              <li key={title} className={`border-t ${rule} pt-4`} style={{ borderTopColor: accent }}>
                <Icon size={18} style={{ color: accent }} />
                <h3 className={`mt-3 text-[0.9375rem] font-medium ${ink}`}>{title}</h3>
                <p className={`mt-1.5 text-[13px] leading-relaxed ${ink2}`}>{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Public vs inside. */}
      <section className={`border-b ${rule}`} style={{ backgroundColor: `${accent}1a` }}>
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 sm:gap-16 sm:py-16 lg:px-10">
          <div>
            <p className="label" style={{ color: accent }}>
              Utad
            </p>
            <p className={`mt-3 max-w-sm text-base leading-relaxed ${ink}`}>
              Offentlig informasjon, åpne arrangementer og organisasjonens arbeid.
            </p>
            {community.links.length > 0 ? (
              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                {community.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1.5 text-[13px] underline decoration-[#b9c3cd] underline-offset-4 transition-colors hover:decoration-current ${ink2}`}
                    >
                      {link.label}
                      <IconExternal size={13} className={ink3} />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div>
            <p className="label" style={{ color: accent }}>
              I fellesskapet
            </p>
            <p className={`mt-3 max-w-sm text-base leading-relaxed ${ink}`}>
              Lokallag, samtaler, interne arrangementer, prosjekter og samarbeid.
            </p>
            <p className={`mt-5 flex items-start gap-2 text-[13px] leading-relaxed ${ink3}`}>
              <IconLock size={13} className="mt-[3px] shrink-0" />
              Synlig for folk som har fått tilgang, ikke på denne siden.
            </p>
          </div>
        </div>
      </section>

      {/* Access. Compact on purpose: the section holds one explanation and one
          form, and is sized to that. */}
      <section
        id="tilgang"
        className={`scroll-mt-4 border-b ${rule}`}
        style={{ backgroundColor: `${accent}2e`, borderTop: `2px solid ${accent}` }}
      >
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-14 lg:px-10 lg:py-[4.5rem]">
          {isMember ? (
            <div className="max-w-lg">
              <p className="label" style={{ color: accent }}>
                Du har tilgang
              </p>
              <p className={`mt-3 text-base leading-relaxed ${ink}`}>
                Lokallaget ditt, feeden, kanalene og Organisasjonen ligger ett trykk unna.
              </p>
              <Link
                href={communityHref}
                className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-[3px] px-6 text-sm font-medium text-white"
                style={{ backgroundColor: accent }}
              >
                Åpne fellesskapet
                <IconArrowRight size={16} />
              </Link>
            </div>
          ) : pending ? (
            <div className="max-w-lg">
              <p className="label" style={{ color: accent }}>
                Forespørsel sendt
              </p>
              <h2 className={`mt-3 font-display text-[1.75rem] leading-[1.12] sm:text-[2.25rem] ${ink}`}>
                Vi sjekker medlemskapet ditt.
              </h2>
              <p className={`mt-4 text-base leading-relaxed ${ink2}`}>
                Forespørselen din er sendt. Vi sjekker medlemskapet manuelt, og du får normalt
                tilgang innen 24 timer.
              </p>
            </div>
          ) : (
            <>
              <div className="max-w-md">
                <p className="label" style={{ color: accent }}>
                  Få tilgang
                </p>
                <h2 className={`mt-3 font-display text-[1.75rem] leading-[1.12] sm:text-[2.25rem] ${ink}`}>
                  Bli med i det digitale fellesskapet.
                </h2>
                <p className={`mt-4 text-base leading-relaxed ${ink2}`}>
                  Er du medlem i {community.name}? Bruk e-postadressen knyttet til medlemskapet
                  ditt. Vi sjekker medlemskapet manuelt, og du får normalt tilgang innen 24 timer.
                </p>
                <p className={`mt-3 text-[13px] leading-relaxed ${ink3}`}>
                  Er du medlem i {brand.otherOrganisation} også, bruker du samme TING-konto i begge
                  fellesskapene.
                </p>
              </div>
              <div className="max-w-xl">
                <TryggereAccessForm community={community} signedIn={Boolean(user)} />
              </div>
            </>
          )}
        </div>
      </section>

      {/* Public events — a glimpse of what is going on, not the reason to enter. */}
      <section className="bg-paper">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-16 lg:px-10">
          <p className="label" style={{ color: accent }}>
            Et innblikk
          </p>
          <h2 className={`mt-2 font-display text-xl ${ink}`}>Åpne arrangementer</h2>
          {publicEvents.length === 0 ? (
            <p className={`mt-4 max-w-xl text-[13px] leading-relaxed ${ink2}`}>
              Ingen åpne arrangementer akkurat nå. {community.name} legger ut nye her når de er
              klare.
            </p>
          ) : (
            <ul className="mt-6 grid gap-x-10 gap-y-7 md:grid-cols-2">
              {publicEvents.map((event) => (
                <li key={event.id} className={`border-t ${rule} pt-4`}>
                  <h3 className={`font-display text-lg leading-snug ${ink}`}>{event.title}</h3>
                  <p className={`mt-1.5 flex items-start gap-1.5 text-[13px] ${ink2}`}>
                    <IconClock size={14} className="mt-[3px] shrink-0" style={{ color: accent }} />
                    <span className="first-letter:uppercase">
                      {formatEventRange(event.startsAt, event.endsAt)}
                    </span>
                  </p>
                  <p className={`mt-1 flex items-start gap-1.5 text-[13px] ${ink2}`}>
                    <IconMapPin size={14} className="mt-[3px] shrink-0" style={{ color: accent }} />
                    {event.location}
                  </p>
                  <p className={`mt-2.5 text-[13px] leading-relaxed ${ink2}`}>{event.description}</p>
                </li>
              ))}
            </ul>
          )}
          <p className={`mt-6 max-w-xl text-xs leading-relaxed ${ink3}`}>
            Interne møter og arrangementer for medlemmer vises ikke her, og vi oppgir ikke hvem i
            organisasjonen som er vert.
          </p>
        </div>
      </section>

      <footer className={`mt-auto border-t ${rule} bg-paper`}>
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-6 sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <p className={`text-xs ${ink3}`}>
            {community.name} · {community.location} · Siden {community.foundedYear}
            <span className="hidden sm:inline"> · </span>
            <span className="block sm:inline">
              {PUBLIC_HOST}/{community.slug}
            </span>
          </p>
          <Link
            href="/"
            className={`inline-flex items-center gap-2 text-xs transition-colors hover:text-[#46525f] ${ink3}`}
          >
            Drevet av
            <Wordmark className="scale-90" />
          </Link>
        </div>
      </footer>
    </main>
  );
}
