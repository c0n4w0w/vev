import { notFound, redirect } from "next/navigation";
import {
  Avatar,
  Badge,
  ButtonLink,
  EmptyState,
  PageContainer,
  PageHeader,
  Panel,
  SectionHeading,
} from "@/components/ui/primitives";
import { IconLock, IconMapPin, IconShield } from "@/components/ui/icons";
import {
  canViewMemberDirectory,
  getCommunityById,
  getCommunityMembers,
  getMembership,
  getRole,
} from "@/lib/data";
import { formatFullDate, plural } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import type { RoleId } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/members">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Medlemmer · ${community?.name ?? "Fellesskap"}` };
}

const roleOrder: RoleId[] = ["admin", "moderator", "member"];

export default async function MembersPage({
  params,
}: PageProps<"/community/[communityId]/members">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const [membership, canViewDirectory] = await Promise.all([
    getMembership(user.id, community.id),
    canViewMemberDirectory(community.id),
  ]);
  const isAdmin = membership?.role === "admin";

  // The database returns nothing to someone who may not list the membership.
  // Asking first lets the page explain itself instead of rendering an empty
  // list that looks like a fault.
  if (!canViewDirectory) {
    return (
      <PageContainer>
        <PageHeader eyebrow={community.name} title="Medlemmer" />
        <EmptyState
          title="Medlemslisten er ikke åpen her"
          body={`${community.name} har valgt at bare administratorer kan se hvem som er medlem. Du ser fortsatt navnet på dem som skriver innlegg, kommentarer og meldinger du har tilgang til.`}
        />
      </PageContainer>
    );
  }

  const members = await getCommunityMembers(community.id);

  return (
    <PageContainer>
      <PageHeader
        eyebrow={community.name}
        title="Medlemmer"
        lead={`${plural(members.length, "aktiv profil", "aktive profiler")} i dette rommet, av totalt ${community.memberCount} registrerte medlemmer i organisasjonen.`}
        action={
          isAdmin ? (
            <ButtonLink href={`/community/${community.id}/requests`} size="sm" variant="secondary">
              Medlemsforespørsler
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="space-y-10">
        {roleOrder.map((roleId) => {
          const group = members.filter((entry) => entry.membership.role === roleId);
          if (group.length === 0) return null;
          const role = getRole(roleId);

          return (
            <section key={roleId}>
              <SectionHeading>
                {role.label} · {group.length}
              </SectionHeading>
              <p className="-mt-2 mb-4 text-[13px] text-ink-3">{role.description}</p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {group.map(({ user: person, membership: personMembership }) => (
                  <Panel as="li" key={person.id} className="flex gap-3.5 p-4">
                    <Avatar user={person} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[0.9375rem] font-medium text-ink">
                          {person.name}
                        </span>
                        {person.id === user.id ? <Badge tone="skog">Deg</Badge> : null}
                      </p>
                      <p className="mt-0.5 text-[13px] text-ink-2">
                        {personMembership.title ?? role.label}
                      </p>
                      <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-3">
                        {person.bio}
                      </p>
                      <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
                        <span className="inline-flex items-center gap-1">
                          <IconMapPin size={12} />
                          {person.location}
                        </span>
                        <span>Medlem siden {formatFullDate(personMembership.joinedAt)}</span>
                      </p>
                    </div>
                  </Panel>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <Panel className="mt-10 flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        {isAdmin ? (
          <IconShield size={20} className="mt-0.5 shrink-0 text-skog" />
        ) : (
          <IconLock size={20} className="mt-0.5 shrink-0 text-skog" />
        )}
        <p className="max-w-2xl text-[13px] leading-relaxed text-ink-2">
          {isAdmin
            ? `Som administrator i ${community.name} kan du invitere nye medlemmer, behandle forespørsler og endre roller. Medlemslisten deles aldri utenfor fellesskapet.`
            : `Medlemslisten er kun synlig for medlemmer av ${community.name}, og vises verken på den offentlige siden eller andre steder på TING.`}
        </p>
      </Panel>
    </PageContainer>
  );
}
