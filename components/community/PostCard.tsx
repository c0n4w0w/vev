import Link from "next/link";
import { Avatar, Badge, Panel, RichText, cn } from "@/components/ui/primitives";
import { CommunityAvatar } from "@/components/ui/CommunityAvatar";
import { IconMegaphone, IconPin } from "@/components/ui/icons";
import { CommentThread } from "@/components/community/CommentThread";
import { PostActions } from "@/components/community/PostActions";
import { ReactionBar } from "@/components/community/ReactionBar";
import { timeAgo } from "@/lib/format";
import type { Comment, Community, CommunityEmoji, Post, RoleId, User } from "@/lib/types";

function Reactions({ reactions }: { reactions: Post["reactions"] }) {
  if (reactions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {reactions.map((reaction) => (
        <span
          key={reaction.emoji}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-xs text-ink-2"
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          {reaction.userIds.length}
        </span>
      ))}
    </div>
  );
}

export function PostCard({
  post,
  author,
  community,
  showCommunity = false,
  viewer,
  viewerRole,
  comments = [],
  commentAuthors = {},
  customEmojis = [],
}: {
  post: Post;
  author: User;
  community: Community;
  showCommunity?: boolean;
  /**
   * Who is looking. Omitted on screens that only read, such as the home feed,
   * where the card renders reactions and counts without controls.
   */
  viewer?: User;
  viewerRole?: RoleId;
  comments?: Comment[];
  commentAuthors?: Record<string, User>;
  /** This community's own custom emojis. Never another community's. */
  customEmojis?: CommunityEmoji[];
}) {
  const isAnnouncement = post.kind === "announcement";
  const isAuthor = viewer !== undefined && viewer.id === post.authorId;
  const canModerate = viewerRole === "admin" || viewerRole === "moderator";

  return (
    <Panel
      as="article"
      id={`post-${post.id}`}
      className={cn("p-5 sm:p-6", isAnnouncement && "border-l-2")}
      {...(isAnnouncement
        ? { style: { borderLeftColor: community.branding.accent } }
        : {})}
    >
      {showCommunity ? (
        <Link
          href={`/community/${community.id}/feed`}
          className="mb-4 -mt-1 flex items-center gap-2 text-xs text-ink-3 transition-colors hover:text-ink"
        >
          <CommunityAvatar community={community} size="xs" />
          {community.name}
        </Link>
      ) : null}

      <div className="flex items-start gap-3">
        <Avatar user={author} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-ink">{author.name}</span>
            <span className="text-xs text-ink-3">{timeAgo(post.createdAt)}</span>
            {post.editedAt ? (
              <span className="text-xs text-ink-3" title={`Endret ${timeAgo(post.editedAt)}`}>
                · endret
              </span>
            ) : null}
            {isAnnouncement ? (
              <Badge tone="rust">
                <IconMegaphone size={11} />
                Kunngjøring
              </Badge>
            ) : null}
            {post.pinned ? (
              <Badge tone="neutral">
                <IconPin size={11} />
                Festet
              </Badge>
            ) : null}
          </div>

          {post.title ? (
            <h3 className="mt-3 font-display text-xl leading-snug text-ink">{post.title}</h3>
          ) : null}

          <RichText body={post.body} className={post.title ? "mt-2" : "mt-2.5"} />

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            {viewer ? (
              <ReactionBar
                postId={post.id}
                communityId={post.communityId}
                reactions={post.reactions}
                customEmojis={customEmojis}
                viewerId={viewer.id}
                accent={community.branding.accent}
              />
            ) : (
              <>
                <Reactions reactions={post.reactions} />
                <span className="text-xs text-ink-3">
                  {post.commentCount} {post.commentCount === 1 ? "kommentar" : "kommentarer"}
                </span>
              </>
            )}
          </div>

          {viewer ? (
            <>
              <CommentThread
                postId={post.id}
                communityId={post.communityId}
                commentCount={post.commentCount}
                comments={comments}
                authors={commentAuthors}
                viewer={viewer}
                canModerate={canModerate}
                accent={community.branding.accent}
              />
              <PostActions
                post={post}
                canEdit={isAuthor}
                canDelete={isAuthor || canModerate}
                canPin={canModerate}
                accent={community.branding.accent}
              />
            </>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
