import Link from "next/link";
import { AuditList, PlatformHeader, PlatformPage, RequestStatusBadge, StatCard, formatDateTime } from "@/components/platform/ui";
import { ButtonLink } from "@/components/ui/primitives";
import { IconPlus } from "@/components/ui/icons";
import { requireVerifiedOperator } from "@/lib/platform/access";
import { getPlatformOverview, listAuditEntries, listOnboardingRequests } from "@/lib/platform/data";

export const metadata = { title: "Oversikt" };

export default async function PlatformOverviewPage() {
  const access = await requireVerifiedOperator();
  const [overview, pending, activity] = await Promise.all([
    getPlatformOverview(),
    listOnboardingRequests("pending"),
    listAuditEntries({ limit: 8 }),
  ]);

  return (
    <PlatformPage>
      <PlatformHeader
        eyebrow="Plattformadministrasjon"
        title="Oversikt"
        lead="Driften av TING: fellesskap, forespørsler og hva som er gjort. Ingen samtaler, innlegg eller medlemslister vises her."
        action={
          <ButtonLink href="/platform-admin/fellesskap/nytt">
            <IconPlus size={18} />
            Nytt fellesskap
          </ButtonLink>
        }
      />

      <section aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          Nøkkeltall
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Fellesskap i alt" value={overview.communitiesTotal} href="/platform-admin/fellesskap" />
          <StatCard label="Aktive" value={overview.communitiesActive} href="/platform-admin/fellesskap?status=active" />
          <StatCard label="Suspenderte" value={overview.communitiesSuspended} href="/platform-admin/fellesskap?status=suspended" />
          <StatCard label="Ventende forespørsler" value={overview.requestsPending} href="/platform-admin/foresporsler" />
        </div>
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section aria-labelledby="pending-heading">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 id="pending-heading" className="label">
              Ventende forespørsler
            </h2>
            <Link href="/platform-admin/foresporsler" className="text-sm text-ink-3 hover:text-ink">
              Alle
            </Link>
          </div>
          {pending.length === 0 ? (
            <p className="rounded-[6px] border border-dashed border-line-2 px-4 py-6 text-center text-sm text-ink-3">
              Ingen forespørsler venter.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
              {pending.slice(0, 6).map((request) => (
                <li key={request.id}>
                  <Link
                    href={`/platform-admin/foresporsler/${request.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper-2/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{request.organizationName}</span>
                      <span className="block text-xs text-ink-3">{formatDateTime(request.createdAt)}</span>
                    </span>
                    <RequestStatusBadge status={request.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="activity-heading">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 id="activity-heading" className="label">
              Siste aktivitet
            </h2>
            <Link href="/platform-admin/aktivitetslogg" className="text-sm text-ink-3 hover:text-ink">
              Hele loggen
            </Link>
          </div>
          <AuditList entries={activity} compact />
          {access.role !== "owner" ? (
            <p className="mt-2 text-xs text-ink-3">Endringer i plattformtilganger vises bare for plattformeiere.</p>
          ) : null}
        </section>
      </div>
    </PlatformPage>
  );
}
