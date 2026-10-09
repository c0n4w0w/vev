import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalAccess } from "@/components/community/PortalAccess";
import { TryggerePortal } from "@/components/community/TryggerePortal";
import { UtrPortal } from "@/components/community/UtrPortal";
import { Wordmark } from "@/components/shell/Wordmark";
import {
  Badge,
  CommunityMark,
  Panel,
  RichText,
  buttonClass,
} from "@/components/ui/primitives";
import {
  IconArrowRight,
  IconCheck,
  IconClock,
  IconExternal,
  IconGlobe,
  IconLock,
  IconMapPin,
  IconUsers,
} from "@/components/ui/icons";
import {
  getMembership,
  getPortalCommunity,
  getPortalEvents,
  hasPendingAccessRequest,
} from "@/lib/data";
import { formatEventRange, plural } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import { PUBLIC_HOST } from "@/lib/brand";
import { getTryggerePortalBrand } from "@/lib/tryggere-portal";

export async function generateMetadata({ params }: PageProps<"/[portalSlug]">) {
  const { portalSlug } = await params;
  const community = await getPortalCommunity(portalSlug);
  if (!community) return { title: "Ikke funnet" };
  return {
    title: community.name,
    description: community.publicDescription.slice(0, 155),
  };
}

/**
 * A community's public portal — the only page about a community that anyone can
 * reach without an account. It shows exactly what the organisation has chosen
 * to make public: their description, their public events, their links, and a
 * way in. Nothing about members, channels or internal activity is exposed here.
 */
export default async function PortalPage({ params }: PageProps<"/[portalSlug]">) {
  const { portalSlug } = await params;
  const [community, publicEvents] = await Promise.all([
    getPortalCommunity(portalSlug),
    getPortalEvents(portalSlug),
  ]);
  if (!community) notFound();

  const user = await getSessionUser();
  const membership = user ? await getMembership(user.id, community.id) : undefined;
  const accent = community.branding.accent;

  // Whether *this signed-in person* already has a request waiting. Decided in
  // the database from their own session, never from anything typed into the
  // form, and never available to a visitor who has not signed in.
  const pending =
    user && membership?.status !== "active" ? await hasPendingAccessRequest(community.slug) : false;

  // Under The Rug gets its own editorial layout — see UtrPortal for why. Every
  // other community keeps the shared template below, untouched.
  if (community.slug === "under-the-rug") {
    return (
      <UtrPortal
        community={community}
        publicEvents={publicEvents}
        user={user}
        membership={membership}
        pending={pending}
      />
    );
  }

  // Foreningen Tryggere Ruspolitikk and Tryggere Ungdom share one portal; only
  // the brand entry (logo, sibling organisation) and the community record differ.
  const tryggereBrand = getTryggerePortalBrand(community.slug);
  if (tryggereBrand) {
    return (
      <TryggerePortal
        community={community}
        brand={tryggereBrand}
        publicEvents={publicEvents}
        user={user}
        membership={membership}
        pending={pending}
      />
    );
  }

  return (
    <main className="flex min-h-dvh flex-col bg-paper">
      {/* The community's own bar. TING is credited quietly, on the right. */}
      <header className="border-b border-line" style={{ backgroundColor: `${accent}12` }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <span className="flex min-w-0 items-center gap-3">
            <CommunityMark community={community} size="sm" />
            <span className="truncate font-display text-[1.0625rem] text-ink">
              {community.name}
            </span>
          </span>
          {membership?.status === "active" ? (
            <Link href={`/community/${community.id}`} className={buttonClass({ size: "sm" })}>
              Gå til fellesskapet
            </Link>
          ) : user ? (
            <span className="text-sm text-ink-2">Innlogget som {user.name.split(" ")[0]}</span>
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

      <div className="mx-auto w-full max-w-5xl flex-1 px-5 lg:px-8">
        <section className="border-b border-line py-12 lg:py-16">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
            <CommunityMark community={community} size="lg" className="shrink-0" />
            <div className="min-w-0">
              <Badge tone="neutral">
                <IconGlobe size={11} />
                Offentlig side
              </Badge>
              <h1 className="mt-3 font-display text-[2.25rem] leading-[1.1] text-ink sm:text-[3rem]">
                {community.name}
              </h1>
              <p className="mt-2 text-[1.0625rem] text-ink-2">{community.tagline}</p>
              <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-2">
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Sted</dt>
                  <IconMapPin size={14} className="text-ink-3" />
                  <dd>{community.location}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Medlemmer</dt>
                  <IconUsers size={14} className="text-ink-3" />
                  <dd>{plural(community.memberCount, "medlem", "medlemmer")}</dd>
                </div>
                <div>
                  <dt className="sr-only">Stiftet</dt>
                  <dd>Siden {community.foundedYear}</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <div className="grid gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-14">
          <div className="space-y-12">
            <section>
              <h2 className="label mb-4">Om oss</h2>
              <RichText body={community.publicDescription} className="text-base" />
            </section>

            <section>
              <h2 className="label mb-4">Åpne arrangementer</h2>
              {publicEvents.length === 0 ? (
                <p className="text-sm leading-relaxed text-ink-2">
                  Ingen åpne arrangementer akkurat nå. {community.name} legger ut nye her når de er
                  klare.
                </p>
              ) : (
                <ul className="space-y-3">
                  {publicEvents.map((event) => (
                      <Panel as="li" key={event.id} className="p-5">
                        <h3 className="font-display text-lg leading-snug text-ink">
                          {event.title}
                        </h3>
                        <p className="mt-2 flex items-start gap-1.5 text-[13px] text-ink-2">
                          <IconClock size={14} className="mt-[3px] shrink-0 text-ink-3" />
                          <span className="first-letter:uppercase">
                            {formatEventRange(event.startsAt, event.endsAt)}
                          </span>
                        </p>
                        <p className="mt-1 flex items-start gap-1.5 text-[13px] text-ink-2">
                          <IconMapPin size={14} className="mt-[3px] shrink-0 text-ink-3" />
                          {event.location}
                        </p>
                        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                          {event.description}
                        </p>
                      </Panel>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs leading-relaxed text-ink-3">
                Interne møter, vaktlister og medlemsarrangementer vises ikke på denne siden, og
                vi oppgir ikke hvem i organisasjonen som er vert.
              </p>
            </section>

            {community.links.length > 0 ? (
              <section>
                <h2 className="label mb-4">Andre steder</h2>
                <ul className="flex flex-wrap gap-2.5">
                  {community.links.map((link) => (
                    <li key={link.href}>
                      <span className="inline-flex items-center gap-2 rounded-[5px] border border-line bg-surface px-3 py-2 text-[13px] text-ink-2">
                        <IconExternal size={14} className="text-ink-3" />
                        {link.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
            {membership?.status === "active" ? (
              <Panel className="p-5">
                <p className="flex items-center gap-2 text-[0.9375rem] font-medium text-ink">
                  <IconCheck size={17} style={{ color: accent }} />
                  Du er medlem
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                  Du har tilgang til feed, kanaler, arrangementer og medlemslisten i{" "}
                  {community.name}.
                </p>
                <Link
                  href={`/community/${community.id}`}
                  className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[5px] text-sm font-medium text-white"
                  style={{ backgroundColor: accent }}
                >
                  Åpne fellesskapet
                  <IconArrowRight size={16} />
                </Link>
              </Panel>
            ) : (
              <PortalAccess community={community} signedIn={Boolean(user)} pending={pending} />
            )}

            {!user ? (
              <Panel className="p-5">
                <h2 className="text-[0.9375rem] font-medium text-ink">Har du konto på TING?</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                  Samme konto fungerer for alle fellesskap du er med i.
                </p>
                <Link
                  href={`/login?neste=/${community.slug}`}
                  className={`${buttonClass({ variant: "secondary", size: "sm" })} mt-4 w-full`}
                >
                  Logg inn
                </Link>
              </Panel>
            ) : null}

            <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-ink-3">
              <IconLock size={13} className="mt-px shrink-0" />
              Denne siden er alt offentligheten ser. Medlemslister, samtaler og interne
              arrangementer ligger bak innlogging.
            </p>
          </aside>
        </div>
      </div>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 py-6 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <p className="text-xs text-ink-3">
            {community.name} · {PUBLIC_HOST}/{community.slug}
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs text-ink-3 transition-colors hover:text-ink-2"
          >
            Drevet av
            <Wordmark size="footer" />
          </Link>
        </div>
      </footer>
    </main>
  );
}
