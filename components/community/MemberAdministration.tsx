import { setMembershipRoleAction } from "@/app/actions";
import { MemberCard } from "@/components/community/MemberCard";
import { SectionHeading, buttonClass } from "@/components/ui/primitives";
import type { CommunityMember } from "@/lib/data";
import { getRole } from "@/lib/roles";
import type { RoleId } from "@/lib/types";

const roleOrder: RoleId[] = ["admin", "moderator", "member"];
const adminPermissionLabels: Record<RoleId, string> = {
  admin: "Administrator",
  moderator: "Moderator",
  member: "Normal tilgang",
};

function RoleManagementControl({
  member,
  communityId,
}: {
  member: CommunityMember;
  communityId: string;
}) {
  const { membership } = member;

  if (membership.role === "admin") {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
          Tilgang
        </p>
        <p className="mt-1 text-[13px] font-medium text-ink">Administrator</p>
        <p className="mt-0.5 text-[12px] text-ink-3">Full administrasjonstilgang</p>
      </div>
    );
  }

  return (
    <form
      action={setMembershipRoleAction}
      className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-end"
    >
      <input type="hidden" name="communityId" value={communityId} />
      <input type="hidden" name="membershipId" value={membership.id ?? ""} />
      <label className="min-w-0 flex-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
          Tilgang
        </span>
        <select
          name="role"
          defaultValue={membership.role}
          className="mt-1 h-9 w-full rounded-[5px] border border-line-2 bg-surface px-2 text-[13px] text-ink outline-none focus:border-ink-3"
        >
          <option value="member">Normal tilgang</option>
          <option value="moderator">Moderator</option>
        </select>
      </label>
      <button type="submit" className={buttonClass({ variant: "secondary", size: "sm" })}>
        Lagre
      </button>
    </form>
  );
}

/**
 * The admin-only member directory: everyone grouped by role, with a control to
 * change it. Shared by every community's admin members page so the
 * role-management UI exists in exactly one place.
 */
export function MemberAdministration({
  members,
  userId,
  communityId,
  dmActions,
}: {
  members: CommunityMember[];
  userId: string;
  communityId: string;
  dmActions: Map<string, string | undefined>;
}) {
  return (
    <div className="space-y-10">
      {roleOrder.map((roleId) => {
        const group = members.filter((entry) => entry.membership.role === roleId);
        if (group.length === 0) return null;
        const role = getRole(roleId);
        const label = adminPermissionLabels[roleId];

        return (
          <section key={roleId}>
            <SectionHeading>
              {label} · {group.length}
            </SectionHeading>
            <p className="-mt-2 mb-4 text-[13px] text-ink-3">{role.description}</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {group.map(({ user: person, membership: personMembership }) => (
                <MemberCard
                  key={person.id}
                  member={{ user: person, membership: personMembership }}
                  userId={userId}
                  communityId={communityId}
                  dmActions={dmActions}
                  roleManagement={
                    <RoleManagementControl
                      member={{ user: person, membership: personMembership }}
                      communityId={communityId}
                    />
                  }
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
