"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Image from "next/image";
import { toggleReactionAction } from "@/app/actions";
import { emptyCommentFormState, reactionPalette } from "@/lib/comment-form";
import { IconPlus, IconSearch } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import type { CommunityEmoji, Reaction } from "@/lib/types";

/** A custom emoji image, or its name if the signed URL could not be made. */
function CustomEmoji({ name, url, size = 16 }: { name: string; url?: string; size?: number }) {
  if (!url) return <span className="text-[11px] text-ink-3">:{name}:</span>;
  return (
    <Image
      src={url}
      alt={`:${name}:`}
      title={`:${name}:`}
      width={size}
      height={size}
      unoptimized
      className="inline-block object-contain align-text-bottom"
      style={{ width: size, height: size }}
    />
  );
}

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
  const custom = reaction.emojiId ? emojiById.get(reaction.emojiId) : undefined;

  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={mine}
      aria-label={reaction.emoji ?? `:${reaction.name ?? "emoji"}:`}
      title={mine ? "Trykk for å fjerne reaksjonen din" : "Reager"}
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
  const [state, formAction] = useActionState(toggleReactionAction, emptyCommentFormState);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  const emojiById = new Map(customEmojis.map((emoji) => [emoji.id, emoji]));
  const usedUnicode = new Set(reactions.map((r) => r.emoji).filter(Boolean));
  const usedCustom = new Set(reactions.map((r) => r.emojiId).filter(Boolean));

  const unusedBuiltIn = reactionPalette.filter((emoji) => !usedUnicode.has(emoji));
  const matchingCustom = customEmojis.filter(
    (emoji) => !usedCustom.has(emoji.id) && emoji.name.includes(query.trim().toLowerCase()),
  );

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
          aria-label="Legg til en reaksjon"
          className="inline-flex items-center rounded-full border border-dashed border-line-2 px-2 py-1 text-ink-3 transition-colors hover:text-ink"
        >
          <IconPlus size={12} />
        </button>

        {picking ? (
          <>
            <button
              type="button"
              aria-label="Lukk"
              onClick={() => setPicking(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div className="absolute bottom-[calc(100%+6px)] left-0 z-50 w-64 rounded-[6px] border border-line-2 bg-surface p-3 shadow-[0_12px_32px_-12px_rgba(23,25,26,0.28)]">
              <p className="label mb-2">Standard</p>
              <div className="flex flex-wrap gap-1.5">
                {unusedBuiltIn.map((emoji) => (
                  <form key={emoji} action={formAction} onSubmit={() => setPicking(false)}>
                    {hidden({ emoji })}
                    <button
                      type="submit"
                      className="rounded-[5px] px-1.5 py-1 text-base transition-colors hover:bg-paper-2"
                      aria-label={emoji}
                    >
                      {emoji}
                    </button>
                  </form>
                ))}
                {unusedBuiltIn.length === 0 ? (
                  <span className="text-xs text-ink-3">Alle er i bruk.</span>
                ) : null}
              </div>

              <p className="label mb-2 mt-4">Fellesskapets egne</p>
              {customEmojis.length === 0 ? (
                <p className="text-xs leading-relaxed text-ink-3">
                  Ingen egne emojier ennå. Moderatorer kan legge til noen under Emojier.
                </p>
              ) : (
                <>
                  <label className="mb-2 flex items-center gap-1.5 rounded-[5px] border border-line px-2 py-1">
                    <IconSearch size={12} className="shrink-0 text-ink-3" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Søk"
                      className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-3"
                    />
                  </label>
                  <div className="scroll-quiet flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                    {matchingCustom.map((emoji) => (
                      <form key={emoji.id} action={formAction} onSubmit={() => setPicking(false)}>
                        {hidden({ emojiId: emoji.id })}
                        <button
                          type="submit"
                          title={`:${emoji.name}:`}
                          aria-label={`:${emoji.name}:`}
                          className="rounded-[5px] p-1 transition-colors hover:bg-paper-2"
                        >
                          <CustomEmoji name={emoji.name} url={emoji.url} size={20} />
                        </button>
                      </form>
                    ))}
                    {matchingCustom.length === 0 ? (
                      <span className="text-xs text-ink-3">Ingen treff.</span>
                    ) : null}
                  </div>
                </>
              )}
            </div>
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
