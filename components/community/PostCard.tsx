import Link from "next/link";
import { Avatar, Badge, CommunityMark, Panel, RichText, cn } from "@/components/ui/primitives";
import { IconMegaphone, IconPin } from "@/components/ui/icons";
import { timeAgo } from "@/lib/format";
import type { Community, Post, User } from "@/lib/types";

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
}: {
  post: Post;
  author: User;
  community: Community;
  showCommunity?: boolean;
}) {
  const isAnnouncement = post.kind === "announcement";

  return (
    <Panel
      as="article"
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
          <CommunityMark community={community} size="xs" />
          {community.name}
        </Link>
      ) : null}

      <div className="flex items-start gap-3">
        <Avatar user={author} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-ink">{author.name}</span>
            <span className="text-xs text-ink-3">{timeAgo(post.createdAt)}</span>
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
            <Reactions reactions={post.reactions} />
            <span className="text-xs text-ink-3">
              {post.commentCount} {post.commentCount === 1 ? "kommentar" : "kommentarer"}
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
