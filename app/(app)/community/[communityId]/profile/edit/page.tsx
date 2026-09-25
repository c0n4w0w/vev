import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CommunityProfileEditor } from "@/components/community/CommunityProfileEditor";
import { IconArrowLeft } from "@/components/ui/icons";
import { PageContainer, PageHeader } from "@/components/ui/primitives";
import { getCommunityById, getCommunityPersona } from "@/lib/data";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/profile/edit">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Profilen din · ${community?.name ?? "Fellesskap"}` };
}

/**
 * Your profile in one community. One community at a time, by design: the
 * whole point is that each one is edited — and seen — on its own.
 *
 * The community layout has already sent anyone without an active membership
 * back to the portal, so an inactive member never reaches the form. The
 * actions and the database check that again on every save.
 */
export default async function EditCommunityProfilePage({
  params,
}: PageProps<"/community/[communityId]/profile/edit">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const persona = await getCommunityPersona(community.id, user.id);

  return (
    <PageContainer width="narrow">
      <Link
        href="/profile"
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink-2 transition-colors hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Kontoen din
      </Link>
      <PageHeader
        eyebrow={community.name}
        title="Profilen din her"
        lead={`Slik vises du for andre i ${community.name}. Endringer her påvirker ikke profilene dine i andre fellesskap.`}
      />
      <CommunityProfileEditor persona={persona} communityName={community.name} />
    </PageContainer>
  );
}
