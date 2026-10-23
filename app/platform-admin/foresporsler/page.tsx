import Link from "next/link";
import { PlatformHeader, PlatformPage, RequestStatusBadge, formatDateTime } from "@/components/platform/ui";
import { EmptyState, cn } from "@/components/ui/primitives";
import { requireVerifiedOperator } from "@/lib/platform/access";
import { listOnboardingRequests, type RequestStatus } from "@/lib/platform/data";

export const metadata = { title: "Forespørsler" };

const TABS: { value: RequestStatus | "all"; label: string }[] = [
  { value: "pending", label: "Venter" },
  { value: "approved", label: "Godkjent" },
  { value: "rejected", label: "Avslått" },
  { value: "all", label: "Alle" },
];

export default async function PlatformRequestsPage({ searchParams }: PageProps<"/platform-admin/foresporsler">) {
  await requireVerifiedOperator();
  const params = await searchParams;
  const tab = TABS.find((entry) => entry.value === params.status)?.value ?? "pending";
  const requests = await listOnboardingRequests(tab === "all" ? undefined : tab);

  return (
    <PlatformPage>
      <PlatformHeader
        eyebrow="Plattformadministrasjon"
        title="Forespørsler"
        lead="Organisasjoner som har bedt om å bli med på TING, fra skjemaet på /samarbeid. En forespørsel oppretter ingenting før dere godkjenner og oppretter fellesskapet."
      />

      <nav aria-label="Filtrer forespørsler" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((entry) => (
          <Link
            key={entry.value}
            href={entry.value === "pending" ? "/platform-admin/foresporsler" : `/platform-admin/foresporsler?status=${entry.value}`}
            aria-current={tab === entry.value ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-10 shrink-0 items-center border-b-2 px-3 text-sm",
              tab === entry.value ? "border-skog font-medium text-skog" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {requests.length === 0 ? (
        <EmptyState
          title={tab === "pending" ? "Ingen forespørsler venter" : "Ingen forespørsler her"}
          body={tab === "pending" ? "Nye forespørsler fra samarbeidsskjemaet dukker opp her." : "Ingen forespørsler har denne statusen."}
        />
      ) : (
        <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
          {requests.map((request) => (
            <li key={request.id}>
              <Link href={`/platform-admin/foresporsler/${request.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-paper-2/40 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{request.organizationName}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {request.contactName} · {request.contactEmail}
                    {request.memberEstimate ? ` · ca. ${request.memberEstimate.toLocaleString("nb-NO")} medlemmer` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-ink-3">{formatDateTime(request.createdAt)}</span>
                  <RequestStatusBadge status={request.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PlatformPage>
  );
}
