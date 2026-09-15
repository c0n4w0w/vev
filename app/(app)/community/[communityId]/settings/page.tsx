import { notFound, redirect } from "next/navigation";
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
 * Your own settings inside one community.
 *
 * Not community administration — nothing here changes the community. These are
 * the choices that belong to one person in one room, which is why a moderator
 * reaches them as readily as an administrator, and why the page never shows
 * anybody else's.
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
        lead={`Dine egne valg i ${community.name}. De gjelder bare deg, og bare her.`}
      />

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
