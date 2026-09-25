import { setMembershipRoleAction } from "@/app/actions";
import { MemberCard } from "@/components/community/MemberCard";
import { SectionHeading, buttonClass } from "@/components/ui/primitives";
import type { CommunityMember } from "@/lib/data";
import { translator, type Locale } from "@/lib/i18n";
import { roleAccessLabel, roleDescription } from "@/lib/roles";
import type { RoleId } from "@/lib/types";

const roleOrder: RoleId[] = ["admin", "moderator", "member"];

function RoleManagementControl({
  member,
  communityId,
  locale,
}: {
  member: CommunityMember;
  communityId: string;
  locale: Locale;
}) {
  const t = translator(locale);
  const { membership } = member;

  if (membership.role === "admin") {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
          {t("role.access.label")}
        </p>
        <p className="mt-1 text-[13px] font-medium text-ink">{t("role.access.admin")}</p>
        <p className="mt-0.5 text-[12px] text-ink-3">{t("role.access.adminDetail")}</p>
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
          {t("role.access.label")}
        </span>
        <select
          name="role"
          defaultValue={membership.role}
          className="mt-1 h-9 w-full rounded-[5px] border border-line-2 bg-surface px-2 text-[13px] text-ink outline-none focus:border-ink-3"
        >
          <option value="member">{t("role.access.member")}</option>
          <option value="moderator">{t("role.access.moderator")}</option>
        </select>
      </label>
      <button type="submit" className={buttonClass({ variant: "secondary", size: "sm" })}>
        {t("common.save")}
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
  locale,
}: {
  members: CommunityMember[];
  userId: string;
  communityId: string;
  dmActions: Map<string, string | undefined>;
  locale: Locale;
}) {
  return (
    <div className="space-y-10">
      {roleOrder.map((roleId) => {
        const group = members.filter((entry) => entry.membership.role === roleId);
        if (group.length === 0) return null;
        const label = roleAccessLabel(roleId, locale);

        return (
          <section key={roleId}>
            <SectionHeading>
              {label} · {group.length}
            </SectionHeading>
            <p className="-mt-2 mb-4 text-[13px] text-ink-3">{roleDescription(roleId, locale)}</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {group.map(({ persona: person, membership: personMembership }) => (
                <MemberCard
                  key={person.id}
                  member={{ persona: person, membership: personMembership }}
                  userId={userId}
                  communityId={communityId}
                  dmActions={dmActions}
                  locale={locale}
                  roleManagement={
                    <RoleManagementControl
                      member={{ persona: person, membership: personMembership }}
                      communityId={communityId}
                      locale={locale}
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
