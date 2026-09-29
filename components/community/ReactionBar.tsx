"use client";

import { startTransition, useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { toggleReactionAction } from "@/app/actions";
import { emptyCommentFormState } from "@/lib/comment-form";
import { CustomEmoji, EmojiPickerPanel } from "@/components/community/EmojiPicker";
import { IconPlus } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/react";
import type { CommunityEmoji, Reaction } from "@/lib/types";

function ReactionButton({
  reaction,
  emojiById,
  count,
  mine,
  accent,
}: {
  reaction: { emoji: string | null; emojiId: string | null; name: string | null };
  emojiById: Map<string, CommunityEmoji>;
  count: number;
  mine: boolean;
  accent: string;
}) {
  const { pending } = useFormStatus();
  const t = useT();
  const custom = reaction.emojiId ? emojiById.get(reaction.emojiId) : undefined;

  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={mine}
      aria-label={reaction.emoji ?? `:${reaction.name ?? "emoji"}:`}
      title={mine ? t("reaction.remove") : t("reaction.react")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50",
        mine ? "text-ink" : "border-line bg-paper text-ink-2 hover:border-line-2",
      )}
      style={mine ? { borderColor: accent, backgroundColor: `${accent}14` } : undefined}
    >
      {reaction.emoji ? (
        <span aria-hidden="true">{reaction.emoji}</span>
      ) : (
        <CustomEmoji name={custom?.name ?? reaction.name ?? "emoji"} url={custom?.url} />
      )}
      {count > 0 ? count : null}
    </button>
  );
}

/**
 * Reactions on a post: built-in Unicode and this community's custom emojis.
 *
 * `customEmojis` only ever contains emojis from the post's own community —
 * they are read through a policy scoped to membership — so the picker cannot
 * show, and a person cannot pick, an emoji belonging to somewhere else. The
 * database refuses such a pairing regardless of what this component renders.
 */
export function ReactionBar({
  postId,
  communityId,
  reactions,
  customEmojis,
  viewerId,
  accent,
}: {
  postId: string;
  communityId: string;
  reactions: Reaction[];
  customEmojis: CommunityEmoji[];
  viewerId: string;
  accent: string;
}) {
  const t = useT();
  const [state, formAction] = useActionState(toggleReactionAction, emptyCommentFormState);
  const [picking, setPicking] = useState(false);

  const emojiById = new Map(customEmojis.map((emoji) => [emoji.id, emoji]));
  const usedUnicode = new Set(reactions.map((r) => r.emoji).filter(Boolean));
  const usedCustom = new Set(reactions.map((r) => r.emojiId).filter(Boolean));

  function hidden(fields: { emoji?: string; emojiId?: string }) {
    return (
      <>
        <input type="hidden" name="postId" value={postId} />
        <input type="hidden" name="communityId" value={communityId} />
        {fields.emoji ? <input type="hidden" name="emoji" value={fields.emoji} /> : null}
        {fields.emojiId ? <input type="hidden" name="emojiId" value={fields.emojiId} /> : null}
      </>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {reactions.map((reaction) => (
        <form key={reaction.emojiId ?? reaction.emoji} action={formAction}>
          {hidden({ emoji: reaction.emoji ?? undefined, emojiId: reaction.emojiId ?? undefined })}
          <ReactionButton
            reaction={reaction}
            emojiById={emojiById}
            count={reaction.userIds.length}
            mine={reaction.userIds.includes(viewerId)}
            accent={accent}
          />
        </form>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setPicking((value) => !value)}
          aria-expanded={picking}
          aria-label={t("reaction.add")}
          className="inline-flex items-center rounded-full border border-dashed border-line-2 px-2 py-1 text-ink-3 transition-colors hover:text-ink"
        >
          <IconPlus size={12} />
        </button>

        {picking ? (
          <>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={() => setPicking(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <EmojiPickerPanel
              // On a phone the "+" can sit anywhere along the row, so anchoring to it
              // would push the panel off screen: centre it above the tab bar instead.
              className="absolute bottom-[calc(100%+6px)] left-0 z-50 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-24 max-sm:mx-auto"
              customEmojis={customEmojis}
              excludeUnicode={usedUnicode}
              excludeCustomIds={usedCustom}
              onPick={(choice) => {
                const form = new FormData();
                form.set("postId", postId);
                form.set("communityId", communityId);
                if ("emoji" in choice) form.set("emoji", choice.emoji);
                else form.set("emojiId", choice.emojiId);
                setPicking(false);
                startTransition(() => formAction(form));
              }}
            />
          </>
        ) : null}
      </div>

      {state.status === "error" ? (
        <span role="alert" className="text-xs text-rust">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
