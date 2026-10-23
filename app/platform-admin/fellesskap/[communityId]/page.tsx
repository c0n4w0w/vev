import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminManagement, CommunityEditForm, CommunityLogoForm, SuspensionPanel } from "@/components/platform/CommunityPanels";
import { AuditList, CommunityStatusBadge, PlatformHeader, PlatformMark, PlatformPage, formatDateTime } from "@/components/platform/ui";
import { Panel } from "@/components/ui/primitives";
import { IconExternal } from "@/components/ui/icons";
import { requireVerifiedOperator } from "@/lib/platform/access";
import { getPlatformCommunity, listAdminInvitations, listAuditEntries } from "@/lib/platform/data";

export const metadata = { title: "Fellesskap" };

function Section({ id, title, children, lead }: { id: string; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <Panel as="section" aria-labelledby={id} className="p-5 sm:p-6">
      <h2 id={id} className="font-display text-xl text-ink">
        {title}
      </h2>
      {lead ? <p className="mt-1 text-sm text-ink-3">{lead}</p> : null}
      <div className="mt-5">{children}</div>
    </Panel>
  );
}

/**
 * One community, as TING operates it: identity, status, who administers it,
 * aggregate counts. Not its members, channels, posts or messages — the
 * operator has no way in from here, and is not made a member by anything on
 * this page.
 */
export default async function PlatformCommunityPage({ params, searchParams }: PageProps<"/platform-admin/fellesskap/[communityId]">) {
  await requireVerifiedOperator();
  const { communityId } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(communityId)) notFound();
  const query = await searchParams;

  const community = await getPlatformCommunity(communityId);
  if (!community) notFound();
  const [invitations, activity] = await Promise.all([
    listAdminInvitations(community.id),
    listAuditEntries({ limit: 20, targetType: "community", targetId: community.id }),
  ]);

  const created = query.opprettet === "1";
  const adminOutcome = typeof query.administrator === "string" ? query.administrator : undefined;
  const notes = typeof query.merknad === "string" ? query.merknad.split(",") : [];

  return (
    <PlatformPage>
      <PlatformHeader
        eyebrow="Fellesskap"
        title={community.name}
        back={{ href: "/platform-admin/fellesskap", label: "Alle fellesskap" }}
        action={<CommunityStatusBadge status={community.status} />}
      />

      {created ? (
        <div role="status" className="mb-8 rounded-[6px] border border-[#cfdfd5] bg-skog-soft px-5 py-4 text-sm text-ink-2">
          <p className="font-medium text-skog">Fellesskapet er opprettet.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {adminOutcome === "assigned" ? <li>Administratoren er utnevnt og har fått beskjed på e-post.</li> : null}
            {adminOutcome === "invited" ? <li>Administratoren er invitert. Personen blir administrator når invitasjonen tas i bruk.</li> : null}
            {adminOutcome === "already-admin" ? <li>Personen var allerede administrator.</li> : null}
            {!adminOutcome ? <li>Ingen administrator er utnevnt ennå. Gjør det under «Administrator».</li> : null}
            {notes.includes("epost") ? <li className="text-rust">E-posten til administratoren kunne ikke sendes. Send invitasjonen på nytt under.</li> : null}
            {notes.includes("logo") ? <li className="text-rust">Logoen kunne ikke lagres. Last den opp på nytt under.</li> : null}
          </ul>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            <Link href={`/${community.slug}`} className="inline-flex items-center gap-1 font-medium text-skog underline underline-offset-2" target="_blank" rel="noreferrer">
              Åpne portalen /{community.slug} <IconExternal size={14} />
            </Link>
            <span className="text-ink-3">Fellesskapets side: /community/{community.id} (krever medlemskap)</span>
          </div>
        </div>
      ) : null}

      <div className="space-y-6">
        <Section id="ops" title="Driftsinformasjon">
          <div className="flex items-start gap-4">
            <PlatformMark accent={community.accent} monogram={community.monogram} markStyle={community.markStyle} size="lg" />
            <dl className="grid flex-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-3">Identifikator</dt>
                <dd className="font-mono text-ink">{community.id}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Portal</dt>
                <dd>
                  {community.status === "active" ? (
                    <Link href={`/${community.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-ink underline decoration-line-2 underline-offset-2">
                      /{community.slug} <IconExternal size={13} />
                    </Link>
                  ) : (
                    <span className="font-mono text-ink-3">/{community.slug} (skjult mens suspendert)</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Aktive medlemmer</dt>
                <dd className="text-ink">
                  {community.memberCount} <span className="text-ink-3">({community.moderatorCount} moderatorer)</span>
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Opprettet</dt>
                <dd className="text-ink">
                  {community.provisionedAt ? formatDateTime(community.provisionedAt) : "Før plattformadministrasjon"}
                  {community.provisionedByEmail ? <span className="block text-xs text-ink-3">av {community.provisionedByEmail}</span> : null}
                </dd>
              </div>
              {community.onboardingRequestId ? (
                <div>
                  <dt className="text-ink-3">Forespørsel</dt>
                  <dd>
                    <Link href={`/platform-admin/foresporsler/${community.onboardingRequestId}`} className="text-ink underline decoration-line-2 underline-offset-2">
                      Se forespørselen
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </Section>

        <Section id="admin" title="Administrator" lead="Et fellesskap har én administrator. Administratoren utnevner selv moderatorer og godkjenner medlemmer.">
          <AdminManagement community={community} invitations={invitations} />
        </Section>

        <Section id="edit" title="Informasjon og innstillinger" lead="Fellesskapets egen «Om»-tekst, kanaler og grupper forvaltes av administratoren, ikke herfra.">
          <CommunityEditForm community={community} />
        </Section>

        <Section id="logo" title="Logo">
          <CommunityLogoForm communityId={community.id} hasAvatar={community.hasAvatar} />
        </Section>

        <Section id="suspension" title={community.status === "suspended" ? "Suspendert" : "Suspensjon"}>
          <SuspensionPanel community={community} />
        </Section>

        <section aria-labelledby="community-activity">
          <h2 id="community-activity" className="label mb-3">
            Aktivitet for dette fellesskapet
          </h2>
          <AuditList entries={activity} />
        </section>
      </div>
    </PlatformPage>
  );
}
