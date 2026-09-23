import { notFound, redirect } from "next/navigation";
import { CommunityAvatarSettings } from "@/components/community/CommunityAvatarSettings";
import { DmAvailabilityToggle } from "@/components/community/DmAvailabilityToggle";
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
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/settings">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Innstillinger · ${community?.name ?? "Fellesskap"}` };
}

/**
 * Settings inside one community.
 *
 * Mostly your own: the choices that belong to one person in one room, which is
 * why a moderator reaches them as readily as an administrator, and why the
 * page never shows anybody else's.
 *
 * The one exception is the community's profile image, shown to the
 * administrator alone. That is presentation — the storage policies and the
 * database function behind it refuse everyone else regardless of what this
 * page draws.
 */
export default async function CommunitySettingsPage({
  params,
}: PageProps<"/community/[communityId]/settings">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

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
        <PageHeader eyebrow={community.name} title="Innstillinger" />
        <EmptyState
          title="Ingen innstillinger for deg her ennå"
          body={`Innstillingene på denne siden gjelder administratorer og moderatorer i ${community.name}.`}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow={community.name}
        title="Innstillinger"
        lead={
          isAdmin
            ? `Fellesskapets profil og dine egne valg i ${community.name}.`
            : `Dine egne valg i ${community.name}. De gjelder bare deg, og bare her.`
        }
      />

      {isAdmin ? (
        <section className="mb-10">
          <SectionHeading>Fellesskapsprofil</SectionHeading>
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

      <SectionHeading>Direkte meldinger</SectionHeading>

      {dmPolicy === "staff_only" ? (
        <>
          <p className="-mt-2 mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-3">
            {community.name} har slått av direkte meldinger mellom medlemmer. Som standard kan
            medlemmer heller ikke skrive til administratorer og moderatorer — hver enkelt av oss
            velger selv om vi vil være tilgjengelige.
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
            {community.name} lar medlemmer sende direkte meldinger til hverandre. Da er du allerede
            tilgjengelig for medlemmene her, og det er ingenting å slå på.
          </p>
        </Panel>
      )}
    </PageContainer>
  );
}
