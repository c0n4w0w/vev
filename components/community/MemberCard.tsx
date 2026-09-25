import type { ReactNode } from "react";
import { startDirectConversationAction } from "@/app/actions";
import { Avatar, Badge, ButtonLink, Panel, buttonClass } from "@/components/ui/primitives";
import type { CommunityMember } from "@/lib/data";
import { formatFullDate } from "@/lib/format";
import { publicMemberTitle } from "@/lib/roles";

/** A member's card in a directory — plain in the member-facing list, with a
 * role-management form appended in the admin one. */
export function MemberCard({
  member,
  userId,
  communityId,
  dmActions,
  permissionBadge,
  roleManagement,
  showJoinedDate = true,
}: {
  member: CommunityMember;
  userId: string;
  communityId: string;
  dmActions: Map<string, string | undefined>;
  permissionBadge?: ReactNode;
  roleManagement?: ReactNode;
  /**
   * "Medlem siden" is admin-facing metadata, not something worth showing a
   * fellow member. Defaults on so the admin member-management page, which
   * still wants it, needs no change; the member-facing directory opts out.
   */
  showJoinedDate?: boolean;
}) {
  const { persona: person, membership: personMembership } = member;
  const title = publicMemberTitle(personMembership.title);

  return (
    <Panel as="li" className="flex gap-3.5 p-4">
      <Avatar user={person} size="md" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[0.9375rem] font-medium text-ink">
            {person.name}
          </span>
          {person.id === userId ? <Badge tone="skog">Deg</Badge> : null}
          {permissionBadge}
        </p>
        {title ? <p className="mt-0.5 text-[13px] text-ink-2">{title}</p> : null}
        {person.bio ? (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-3">
            {person.bio}
          </p>
        ) : null}
        {showJoinedDate ? (
          <p className="mt-2.5 text-[11px] text-ink-3">
            Medlem siden {formatFullDate(personMembership.joinedAt)}
          </p>
        ) : null}
        {dmActions.has(person.id) ? (
          <div className="mt-3">
            {dmActions.get(person.id) ? (
              <ButtonLink
                href={`/community/${communityId}/messages/${dmActions.get(person.id)}`}
                size="sm"
                variant="secondary"
              >
                Send melding
              </ButtonLink>
            ) : (
              <form action={startDirectConversationAction}>
                <input type="hidden" name="communityId" value={communityId} />
                <input type="hidden" name="recipientId" value={person.id} />
                <button
                  type="submit"
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  Send melding
                </button>
              </form>
            )}
          </div>
        ) : null}
        {roleManagement}
      </div>
    </Panel>
  );
}
