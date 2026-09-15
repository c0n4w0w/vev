import { notFound, redirect } from "next/navigation";
import { LocalGroupAdmin } from "@/components/community/LocalGroupAdmin";
import { LocalGroupPicker } from "@/components/community/LocalGroupPicker";
import {
  EmptyState,
  PageContainer,
  PageHeader,
  Panel,
  SectionHeading,
} from "@/components/ui/primitives";
import { IconMapPin } from "@/components/ui/icons";
import {
  getCommunityById,
  getLocalGroupMemberCounts,
  getLocalGroups,
  getMembership,
} from "@/lib/data";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/lokallag">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Lokallag · ${community?.name ?? "Fellesskap"}` };
}

/**
 * Local groups: the member's own affiliation, and — for administrators — the
 * roster of groups itself.
 *
 * Reachable directly after accepting an invitation, and from the sidebar at
 * any time afterwards. Nothing here is required: a member who never opens this
 * page has full access to everything, which is the point.
 */
export default async function LocalGroupsPage({
  params,
  searchParams,
}: PageProps<"/community/[communityId]/lokallag">) {
  const { communityId } = await params;
  const { velkommen } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const [membership, groups, memberCounts] = await Promise.all([
    getMembership(user.id, community.id),
    getLocalGroups(community.id),
    getLocalGroupMemberCounts(community.id),
  ]);

  // A community that has never defined any. The feature simply does not apply
  // here — no slug is consulted to reach that conclusion.
  if (groups.length === 0) {
    return (
      <PageContainer>
        <PageHeader eyebrow={community.name} title="Lokallag" />
        <EmptyState
          title="Dette fellesskapet bruker ikke lokallag"
          body={`${community.name} har ikke opprettet lokallag. Du er medlem av fellesskapet som helhet.`}
        />
      </PageContainer>
    );
  }

  const isAdmin = membership?.role === "admin";
  const selected = groups.find((group) => group.id === membership?.localGroupId);
  const selectable = groups.filter((group) => group.active);
  const welcome = velkommen === "1";

  return (
    <PageContainer>
      <PageHeader
        eyebrow={community.name}
        title={welcome ? "Har du et lokallag?" : "Lokallag"}
        lead={
          welcome
            ? `Du er nå medlem av ${community.name}. Er du tilknyttet et lokallag, kan du velge det her — det er helt valgfritt.`
            : `Lokallagene i ${community.name}. Tilknytningen din gjelder bare her.`
        }
      />

      <SectionHeading>Mitt lokallag</SectionHeading>

      {selected ? (
        <Panel className="mb-6 flex items-center gap-3.5 p-5">
          <IconMapPin size={20} className="shrink-0 text-skog" />
          <div className="min-w-0">
            <p className="text-[13px] text-ink-3">Du er tilknyttet</p>
            <p className="text-[1.0625rem] text-ink">{selected.name}</p>
            {selected.active ? null : (
              <p className="mt-1 text-[12px] text-ink-3">
                Dette lokallaget er avviklet. Du beholder tilknytningen, men den kan ikke velges på
                nytt.
              </p>
            )}
          </div>
        </Panel>
      ) : (
        <p className="mb-6 text-[0.9375rem] text-ink-2">Du har ikke valgt et lokallag.</p>
      )}

      <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-3">
        Velg lokallaget du er tilknyttet. Vet du ikke hvilket, eller hører du ikke til noe lokallag,
        lar du det stå tomt — det påvirker ikke medlemskapet ditt i {community.name}.
      </p>

      <LocalGroupPicker
        communityId={community.id}
        groups={selectable}
        selectedId={selected?.active ? selected.id : undefined}
        accent={community.branding.accent}
        memberCounts={memberCounts}
        welcome={welcome}
      />

      {isAdmin ? (
        <div className="mt-12 border-t border-line pt-8">
          <SectionHeading>Administrer lokallag</SectionHeading>
          <p className="-mt-2 mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-3">
            Som administrator i {community.name} bestemmer du hvilke lokallag medlemmene kan velge
            mellom.
          </p>
          <LocalGroupAdmin
            communityId={community.id}
            groups={groups}
            memberCounts={memberCounts}
          />
        </div>
      ) : null}
    </PageContainer>
  );
}
