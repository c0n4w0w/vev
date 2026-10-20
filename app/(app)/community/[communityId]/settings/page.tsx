import { notFound, redirect } from "next/navigation";
import { CommunityAvatarSettings } from "@/components/community/CommunityAvatarSettings";
import { DmAvailabilityToggle } from "@/components/community/DmAvailabilityToggle";
import { ReactionVisibilitySetting } from "@/components/community/ReactionVisibilitySetting";
import {
  EmptyState,
  PageContainer,
  PageHeader,
  Panel,
  SectionHeading,
} from "@/components/ui/primitives";
import { IconLock } from "@/components/ui/icons";
import {
  getCommunityById,
  getCommunityDmPolicy,
  getMembership,
  myAcceptsMemberDms,
} from "@/lib/data";
import { communityLocale, communityTranslator, translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/settings">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = communityTranslator(community);
  return { title: `${t("settings.title")} · ${community?.name ?? t("common.communityFallback")}` };
}

/**
 * Settings inside one community.
 *
 * Mostly your own: the choices that belong to one person in one room, which is
 * why a moderator reaches them as readily as an administrator, and why the
 * page never shows anybody else's.
 *
 * The exceptions are the community's profile image and who may see who
 * reacted in its channels, shown to the administrator alone. That is
 * presentation — the storage policies and the database functions behind them
 * refuse everyone else regardless of what this page draws.
 */
export default async function CommunitySettingsPage({
  params,
}: PageProps<"/community/[communityId]/settings">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const t = translator(communityLocale(community));

  // The setting is read through its own function, not off the membership row:
  // the column is not readable by clients, so there is no version of this page
  // that could render somebody else's value by mistake.
  const [membership, dmPolicy, acceptsMemberDms] = await Promise.all([
    getMembership(user.id, community.id),
    getCommunityDmPolicy(community.id),
    myAcceptsMemberDms(community.id),
  ]);

  const isStaff = membership?.role === "admin" || membership?.role === "moderator";
  const isAdmin = membership?.role === "admin" && membership.status === "active";

  // Ordinary members have nothing to set here yet. Saying so plainly beats an
  // empty page, and beats hiding a control that the database would refuse
  // anyway.
  if (!isStaff) {
    return (
      <PageContainer>
        <PageHeader eyebrow={community.name} title={t("settings.title")} />
        <EmptyState
          title={t("settings.none.title")}
          body={t("settings.none.body", { name: community.name })}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow={community.name}
        title={t("settings.title")}
        lead={
          isAdmin
            ? t("settings.lead.admin", { name: community.name })
            : t("settings.lead.staff", { name: community.name })
        }
      />

      {isAdmin ? (
        <section className="mb-10">
          <SectionHeading>{t("settings.communityProfile")}</SectionHeading>
          <CommunityAvatarSettings
            community={{
              id: community.id,
              name: community.name,
              branding: community.branding,
              avatarUrl: community.avatarUrl,
            }}
          />
        </section>
      ) : null}

      {isAdmin ? (
        <section className="mb-10">
          <SectionHeading>{t("settings.reactions")}</SectionHeading>
          <Panel className="overflow-hidden">
            <ReactionVisibilitySetting
              communityId={community.id}
              communityName={community.name}
              accent={community.branding.accent}
              initial={community.reactionAuthorVisibility}
            />
          </Panel>
        </section>
      ) : null}

      <SectionHeading>{t("settings.directMessages")}</SectionHeading>

      {dmPolicy === "staff_only" ? (
        <>
          <p className="-mt-2 mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-3">
            {t("settings.dm.staffOnly", { name: community.name })}
          </p>
          <Panel className="overflow-hidden">
            <DmAvailabilityToggle
              communityId={community.id}
              communityName={community.name}
              accent={community.branding.accent}
              initial={acceptsMemberDms}
            />
          </Panel>
        </>
      ) : (
        <Panel className="flex gap-4 p-5">
          <IconLock size={20} className="mt-0.5 shrink-0 text-skog" />
          <p className="max-w-2xl text-[13px] leading-relaxed text-ink-2">
            {t("settings.dm.open", { name: community.name })}
          </p>
        </Panel>
      )}
    </PageContainer>
  );
}
