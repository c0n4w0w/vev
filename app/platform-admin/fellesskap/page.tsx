import Link from "next/link";
import { CommunityStatusBadge, PlatformHeader, PlatformMark, PlatformPage, formatDateTime, inputClass } from "@/components/platform/ui";
import { Button, ButtonLink, EmptyState } from "@/components/ui/primitives";
import { IconPlus, IconSearch } from "@/components/ui/icons";
import { requireVerifiedOperator } from "@/lib/platform/access";
import { listPlatformCommunities, type CommunityStatus } from "@/lib/platform/data";

export const metadata = { title: "Fellesskap" };

export default async function PlatformCommunitiesPage({ searchParams }: PageProps<"/platform-admin/fellesskap">) {
  await requireVerifiedOperator();
  const params = await searchParams;
  const search = typeof params.sok === "string" ? params.sok.slice(0, 100) : "";
  const status: CommunityStatus | undefined =
    params.status === "active" || params.status === "suspended" ? params.status : undefined;
  const communities = await listPlatformCommunities({ search, status });
  const filtered = Boolean(search || status);

  return (
    <PlatformPage width="wide">
      <PlatformHeader
        eyebrow="Plattformadministrasjon"
        title="Fellesskap"
        lead="Alle organisasjoner på TING. Medlemstallet er aktive medlemskap; ingen navn på medlemmer vises."
        action={
          <ButtonLink href="/platform-admin/fellesskap/nytt">
            <IconPlus size={18} />
            Nytt fellesskap
          </ButtonLink>
        }
      />

      <form method="get" role="search" className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="community-search" className="block text-sm font-medium text-ink">
            Søk
          </label>
          <div className="relative mt-1.5">
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              id="community-search"
              name="sok"
              type="search"
              defaultValue={search}
              placeholder="Navn, identifikator eller portaladresse"
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>
        <div className="sm:w-48">
          <label htmlFor="community-status" className="block text-sm font-medium text-ink">
            Status
          </label>
          <select id="community-status" name="status" defaultValue={status ?? ""} className={`${inputClass} mt-1.5`}>
            <option value="">Alle</option>
            <option value="active">Aktive</option>
            <option value="suspended">Suspenderte</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Filtrer
          </Button>
          {filtered ? (
            <ButtonLink href="/platform-admin/fellesskap" variant="ghost">
              Nullstill
            </ButtonLink>
          ) : null}
        </div>
      </form>

      {communities.length === 0 ? (
        <EmptyState
          title={filtered ? "Ingen treff" : "Ingen fellesskap ennå"}
          body={filtered ? "Ingen fellesskap passer søket. Prøv et annet ord eller nullstill filteret." : "Opprett det første fellesskapet for å komme i gang."}
          action={
            filtered ? undefined : (
              <ButtonLink href="/platform-admin/fellesskap/nytt">
                <IconPlus size={18} /> Nytt fellesskap
              </ButtonLink>
            )
          }
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-3" aria-live="polite">
            {communities.length} {communities.length === 1 ? "fellesskap" : "fellesskap"}
          </p>
          {/* Table on wide screens, cards on narrow ones. */}
          <div className="hidden overflow-hidden rounded-[6px] border border-line bg-surface md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-paper-2/50 text-xs text-ink-3">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Fellesskap</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Administrator</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Medlemmer</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Opprettet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {communities.map((community) => (
                  <tr key={community.id} className="hover:bg-paper-2/40">
                    <td className="px-4 py-3">
                      <Link href={`/platform-admin/fellesskap/${community.id}`} className="flex items-center gap-3">
                        <PlatformMark accent={community.accent} monogram={community.monogram} markStyle={community.markStyle} />
                        <span className="min-w-0">
                          <span className="block font-medium text-ink underline-offset-2 hover:underline">{community.name}</span>
                          <span className="block font-mono text-[12px] text-ink-3">
                            {community.id}
                            {community.slug !== community.id ? ` · /${community.slug}` : ""}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <CommunityStatusBadge status={community.status} />
                    </td>
                    <td className="px-4 py-3">
                      {community.adminEmail ? (
                        <span className="block">
                          <span className="block text-ink">{community.adminName}</span>
                          <span className="block text-xs text-ink-3">{community.adminEmail}</span>
                        </span>
                      ) : community.pendingAdminEmail ? (
                        <span className="text-xs text-ink-3">Invitert: {community.pendingAdminEmail}</span>
                      ) : (
                        <span className="text-xs text-rust">Ingen administrator</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{community.memberCount}</td>
                    <td className="px-4 py-3 text-xs text-ink-3">
                      {community.provisionedAt ? formatDateTime(community.provisionedAt) : "Før plattformadministrasjon"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {communities.map((community) => (
              <li key={community.id}>
                <Link
                  href={`/platform-admin/fellesskap/${community.id}`}
                  className="block rounded-[6px] border border-line bg-surface px-4 py-3"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{community.name}</span>
                      <span className="block font-mono text-[12px] text-ink-3">{community.id}</span>
                    </span>
                    <CommunityStatusBadge status={community.status} />
                  </span>
                  <span className="mt-2 block text-xs text-ink-3">
                    {community.memberCount} medlemmer ·{" "}
                    {community.adminEmail ?? (community.pendingAdminEmail ? `Invitert: ${community.pendingAdminEmail}` : "Ingen administrator")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </PlatformPage>
  );
}
