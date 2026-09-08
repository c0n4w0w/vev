import { notFound, redirect } from "next/navigation";
import { PostCard } from "@/components/community/PostCard";
import { EmptyState, PageContainer, PageHeader, Panel } from "@/components/ui/primitives";
import { IconMegaphone } from "@/components/ui/icons";
import {
  getAnnouncements,
  getCommentsForPosts,
  getCommunityEmojis,
  getCommunityById,
  getMembership,
  getUsers,
} from "@/lib/data";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/announcements">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Kunngjøringer · ${community?.name ?? "Fellesskap"}` };
}

export default async function AnnouncementsPage({
  params,
}: PageProps<"/community/[communityId]/announcements">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const [membership, announcements] = await Promise.all([
    getMembership(user.id, community.id),
    getAnnouncements(community.id),
  ]);
  const customEmojis = await getCommunityEmojis(community.id);
  const commentsByPost = await getCommentsForPosts(announcements.map((post) => post.id));
  const participantIds = new Set([
    ...announcements.map((post) => post.authorId),
    ...[...commentsByPost.values()].flat().map((comment) => comment.authorId),
  ]);
  const authors = new Map(
    (await getUsers([...participantIds])).map((u) => [
      u.id,
      u,
    ]),
  );

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={community.name}
        title="Kunngjøringer"
        lead="Beskjeder som gjelder alle. Kun moderatorer og administratorer kan publisere her."
      />

      {membership && membership.role !== "member" ? (
        <Panel className="mb-6 flex items-center gap-3 bg-rust-soft/50 p-4">
          <IconMegaphone size={18} className="shrink-0 text-rust" />
          <p className="text-[13px] leading-relaxed text-ink-2">
            Du kan publisere kunngjøringer i {community.name}. De varsler alle medlemmer, så bruk
            dem sparsomt.
          </p>
        </Panel>
      ) : null}

      {announcements.length === 0 ? (
        <EmptyState
          title="Ingen kunngjøringer"
          body="Når noen i ledelsen publiserer en beskjed til hele fellesskapet, havner den her."
        />
      ) : (
        <div className="space-y-4">
          {announcements.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              author={authors.get(post.authorId)!}
              community={community}
              viewer={user}
              comments={commentsByPost.get(post.id) ?? []}
              commentAuthors={Object.fromEntries(authors)}
              customEmojis={customEmojis}
              viewerRole={membership?.role}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
