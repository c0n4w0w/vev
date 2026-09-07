import { notFound, redirect } from "next/navigation";
import { PostCard } from "@/components/community/PostCard";
import { Composer } from "@/components/community/Composer";
import { PageContainer, PageHeader } from "@/components/ui/primitives";
import { getCommunityById, getFeed, getMembership, getUsers } from "@/lib/data";
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
  const authors = new Map(
    (await getUsers([...new Set(feed.map((post) => post.authorId))])).map((u) => [u.id, u]),
  );

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={community.name}
        title="Feed"
        lead={`Innlegg og kunngjøringer fra medlemmene i ${community.name}, nyeste først.`}
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
            viewerId={user.id}
            viewerRole={membership?.role}
          />
        ))}
      </div>
    </PageContainer>
  );
}
