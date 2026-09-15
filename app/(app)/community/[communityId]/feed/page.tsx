import { notFound, redirect } from "next/navigation";
import { PostCard } from "@/components/community/PostCard";
import { Composer } from "@/components/community/Composer";
import { PageContainer, PageHeader } from "@/components/ui/primitives";
import {
  getCommentsForPosts,
  getCommunityEmojis,
  getCommunityById,
  getFeed,
  getMembership,
  getUsers,
} from "@/lib/data";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/feed">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Feed · ${community?.name ?? "Fellesskap"}` };
}

export default async function CommunityFeedPage({
  params,
}: PageProps<"/community/[communityId]/feed">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const [membership, feed] = await Promise.all([
    getMembership(user.id, community.id),
    getFeed(community.id),
  ]);
  const customEmojis = await getCommunityEmojis(community.id);
  const commentsByPost = await getCommentsForPosts(feed.map((post) => post.id));
  const participantIds = new Set([
    ...feed.map((post) => post.authorId),
    ...[...commentsByPost.values()].flat().map((comment) => comment.authorId),
  ]);
  const authors = new Map(
    (await getUsers([...participantIds])).map((u) => [u.id, u]),
  );

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={community.name}
        title="Feed"
        lead={`Alt som skjer i ${community.name} — innlegg og kunngjøringer, nyeste først.`}
      />

      <Composer
        user={user}
        community={community}
        canAnnounce={membership?.role === "admin" || membership?.role === "moderator"}
      />

      <div className="mt-6 space-y-4">
        {feed.map((post) => (
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
    </PageContainer>
  );
}
