import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CreateCollaborationForm,
  type RepresentableOrganization,
} from "@/components/collaboration/CreateCollaborationForm";
import { IconArrowLeft } from "@/components/ui/icons";
import { EmptyState, PageContainer, PageHeader } from "@/components/ui/primitives";
import { encodeUnit } from "@/lib/collaboration-form";
import { getCommunitiesForUser, getLocalGroups } from "@/lib/data";
import { PLATFORM_LOCALE, translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

const t = translator(PLATFORM_LOCALE);

export const metadata: Metadata = { title: t("collab.new.metaTitle") };

/**
 * Starting a collaboration on behalf of a unit the person represents.
 *
 * In v1 that is an organisation the person administers, as a whole or through
 * one of its own active local groups. The list is built from the person's own
 * memberships and their own organisation's local groups — never anyone
 * else's — and `create_collaboration()` checks the choice again.
 */
export default async function NewCollaborationPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const administered = (await getCommunitiesForUser(user.id)).filter(
    ({ membership }) => membership.role === "admin",
  );
  const organizations: RepresentableOrganization[] = await Promise.all(
    administered.map(async ({ community }) => ({
      communityId: community.id,
      communityName: community.name,
      wholeValue: encodeUnit(community.id),
      localGroups: (await getLocalGroups(community.id))
        .filter((group) => group.active)
        .map((group) => ({ value: encodeUnit(community.id, group.id), name: group.name })),
    })),
  );

  return (
    <PageContainer width="narrow">
      <Link
        href="/collaborations"
        className="mb-6 inline-flex items-center gap-1.5 rounded-[4px] text-[13px] text-ink-2 transition-colors hover:text-ink"
      >
        <IconArrowLeft size={14} />
        {t("collab.back")}
      </Link>
      <PageHeader title={t("collab.new.title")} lead={t("collab.new.lead")} />
      {organizations.length === 0 ? (
        <EmptyState title={t("collab.new.notAllowed.title")} body={t("collab.new.notAllowed.body")} />
      ) : (
        <CreateCollaborationForm organizations={organizations} />
      )}
    </PageContainer>
  );
}
