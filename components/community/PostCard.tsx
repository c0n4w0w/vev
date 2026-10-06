import Link from "next/link";
import { Avatar, Badge, Panel, RichText, cn } from "@/components/ui/primitives";
import { CommunityAvatar } from "@/components/ui/CommunityAvatar";
import { IconLock, IconMapPin, IconMegaphone, IconPin } from "@/components/ui/icons";
import { CommentThread } from "@/components/community/CommentThread";
import { PostActions } from "@/components/community/PostActions";
import { ReactionBar } from "@/components/community/ReactionBar";
import { timeAgo } from "@/lib/format";
import { communityLocale, tn, translator, type Locale } from "@/lib/i18n";
import type { Comment, Community, CommunityEmoji, CommunityPersona, Post, RoleId } from "@/lib/types";

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

/**
 * The badges beside a post's author and time, always in the same order:
 *
 *   scope — which local group the post is for, when it has one
 *   type  — announcement
 *   state — pinned
 *
 * Where it applies, what kind of post it is, whether it is held at the top.
 * A community-wide post has no scope badge at all: absence is what "the whole
 * organisation" looks like, so there is no "Hele fellesskapet" chip to read
 * past on nearly every post.
 *
 * The scope label is the local group's own name, verbatim. Organisations name
 * their units with their own prefix ("FTR Oslo", "TU UiO"), and that prefix is
 * not derivable from anything else: the community monogram is "TR", not
 * "FTR". Showing the name as the organisation wrote it is what keeps an FTR
 * post from ever being labelled as TU's, with nothing organisation-specific
 * here.
 *
 * Scope is the quietest of the three (outline) so it never competes with an
 * announcement. The pin icon is decorative; the visible name carries the
 * meaning, and screen readers hear "Lokallag: FTR Oslo".
 */
export function PostBadges({ post, locale }: { post: Post; locale: Locale }) {
  const t = translator(locale);
  const isAnnouncement = post.kind === "announcement";
  if (!post.localGroup && !post.subgroup && !isAnnouncement && !post.pinned) return null;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {post.localGroup ? (
        <Badge tone="outline" className="max-w-full">
          <IconMapPin size={11} className="shrink-0" />
          <span className="sr-only">{t("post.scopePrefix")} </span>
          <span className="truncate">{post.localGroup.name}</span>
        </Badge>
      ) : null}
      {post.subgroup ? (
        <Badge tone="outline" className="max-w-full">
          <IconLock size={11} className="shrink-0" />
          <span className="sr-only">{t("post.subgroupPrefix")} </span>
          <span className="truncate">{post.subgroup.name}</span>
        </Badge>
      ) : null}
      {isAnnouncement ? (
        <Badge tone="rust">
          <IconMegaphone size={11} />
          {t("post.announcement")}
        </Badge>
      ) : null}
      {post.pinned ? (
        <Badge tone="neutral">
          <IconPin size={11} />
          {t("post.pinned")}
        </Badge>
      ) : null}
    </span>
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
  locale: localeOverride,
}: {
  post: Post;
  author: CommunityPersona;
  community: Community;
  showCommunity?: boolean;
  /**
   * Who is looking. Omitted on screens that only read, such as the home feed,
   * where the card renders reactions and counts without controls.
   */
  viewer?: CommunityPersona;
  viewerRole?: RoleId;
  comments?: Comment[];
  commentAuthors?: Record<string, CommunityPersona>;
  /** This community's own custom emojis. Never another community's. */
  customEmojis?: CommunityEmoji[];
  /**
   * The language of the screen this card sits on. Defaults to the post's own
   * community; a page in another language (the home feed) passes its own so a
   * card never switches language halfway down the page.
   */
  locale?: Locale;
}) {
  const locale = localeOverride ?? communityLocale(community);
  const t = translator(locale);
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
            <span className="text-xs text-ink-3">{timeAgo(post.createdAt, locale)}</span>
            {post.editedAt ? (
              <span className="text-xs text-ink-3" title={t("post.editedAt", { time: timeAgo(post.editedAt, locale) })}>
                · {t("common.edited")}
              </span>
            ) : null}
            <PostBadges post={post} locale={locale} />
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
                  {tn(locale, "count.comments", post.commentCount)}
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
                customEmojis={customEmojis}
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
