import { notFound, redirect } from "next/navigation";
import { PostCard } from "@/components/community/PostCard";
import { Composer } from "@/components/community/Composer";
import { EmptyState, PageContainer, PageHeader, cn } from "@/components/ui/primitives";
import {
  getCommentsForPosts,
  getCommunityEmojis,
  getCommunityById,
  getFeed,
  getLocalGroups,
  getCommunityPersonas,
  getMembership,
} from "@/lib/data";
import { communityLocale, communityTranslator, translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/feed">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = communityTranslator(community);
  return { title: `${t("feed.title")} · ${community?.name ?? t("common.communityFallback")}` };
}

export default async function CommunityFeedPage({
  params,
}: PageProps<"/community/[communityId]/feed">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const t = translator(communityLocale(community));

  const [membership, feed, groups] = await Promise.all([
    getMembership(user.id, community.id),
    getFeed(community.id),
    getLocalGroups(community.id),
  ]);
  const customEmojis = await getCommunityEmojis(community.id);
  const commentsByPost = await getCommentsForPosts(feed.map((post) => post.id));
  // Everyone as they appear in this community — the viewer included, so the
  // composer and their own posts carry the same name and photo as everyone
  // else sees.
  const participantIds = new Set([
    user.id,
    ...feed.map((post) => post.authorId),
    ...[...commentsByPost.values()].flat().map((comment) => comment.authorId),
  ]);
  const authors = await getCommunityPersonas(community.id, [...participantIds]);
  const me = authors.get(user.id)!;
  // The feed is an official surface: active admins and moderators publish,
  // everyone else reads, comments and reacts. This only decides whether the
  // composer is rendered — `posts_insert` in the database is what refuses a
  // member's post, whatever reaches it.
  const canPublish =
    membership?.status === "active" &&
    (membership.role === "admin" || membership.role === "moderator");

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={community.name}
        title={t("feed.title")}
        lead={t("feed.lead", { name: community.name })}
      />

      {/*
        Not rendered at all for members — no disabled box, no "no access"
        note. For them the page is simply the feed, starting under the header.
      */}
      {canPublish ? (
        <Composer
          user={me}
          community={community}
          // Announcement authority is the same can_moderate() rule as
          // publishing itself, so everyone who sees the composer may use it.
          canAnnounce
          localGroups={groups.filter((group) => group.active)}
        />
      ) : null}

      {feed.length === 0 ? (
        <div className={cn(canPublish && "mt-6")}>
          <EmptyState
            title={t("feed.empty.title")}
            body={t("feed.empty.body", { name: community.name })}
          />
        </div>
      ) : (
        <div className={cn("space-y-4", canPublish && "mt-6")}>
          {feed.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              author={authors.get(post.authorId)!}
              community={community}
              viewer={me}
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
