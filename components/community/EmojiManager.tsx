"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Image from "next/image";
import { createEmojiAction, deleteEmojiAction } from "@/app/actions";
import { emptyCommentFormState } from "@/lib/comment-form";
import { EMOJI_MAX_DIMENSION, normalizeEmojiName } from "@/lib/emoji-image";
import { EmptyState, Panel } from "@/components/ui/primitives";
import { IconClose } from "@/components/ui/icons";
import { formatFullDate } from "@/lib/format";
import type { CommunityEmoji, User } from "@/lib/types";

function Submit({ label, pendingLabel, className, style, disabled }: {
  label: string;
  pendingLabel: string;
  className: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className} style={style}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function DeleteEmoji({ emoji, communityId }: { emoji: CommunityEmoji; communityId: string }) {
  const [state, action] = useActionState(deleteEmojiAction, emptyCommentFormState);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-ink-3 transition-colors hover:text-rust"
      >
        Slett
      </button>
    );
  }
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="emojiId" value={emoji.id} />
      <input type="hidden" name="communityId" value={communityId} />
      <Submit
        label="Ja, slett"
        pendingLabel="Sletter …"
        className="text-xs font-medium text-rust transition-opacity hover:opacity-70"
      />
      <button
        type="button"
        onClick={() => setConfirming(false)}
        aria-label="Avbryt"
        className="text-ink-3 transition-colors hover:text-ink"
      >
        <IconClose size={12} />
      </button>
      {state.status === "error" ? (
        <span role="alert" className="text-xs text-rust">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/**
 * Custom emoji management for a community.
 *
 * Rendered only for moderators and admins, but that is presentation: both the
 * upload and the delete are refused by the storage policies and the table
 * policy for anyone else, whatever this component draws.
 */
export function EmojiManager({
  communityId,
  emojis,
  authors,
  canManage,
  accent,
}: {
  communityId: string;
  emojis: CommunityEmoji[];
  authors: Record<string, User>;
  canManage: boolean;
  accent: string;
}) {
  const [state, formAction] = useActionState(createEmojiAction, emptyCommentFormState);
  const [name, setName] = useState("");
  const [fileName, setFileName] = useState("");

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "ok") {
      setName("");
      setFileName("");
    }
  }

  const preview = normalizeEmojiName(name);

  return (
    <div className="space-y-8">
      {canManage ? (
        <Panel className="p-5">
          <h2 className="font-display text-lg text-ink">Legg til en emoji</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
            PNG, GIF eller WebP, maks {EMOJI_MAX_DIMENSION}×{EMOJI_MAX_DIMENSION} piksler og 256 KB.
            Emojien er kun synlig for medlemmer av dette fellesskapet.
          </p>

          <form action={formAction} className="mt-4 space-y-3">
            <input type="hidden" name="communityId" value={communityId} />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1">
                <span className="label">Navn</span>
                <span className="mt-1.5 flex items-center rounded-[5px] border border-line-2 bg-surface px-3 focus-within:border-ink-3">
                  <span className="text-sm text-ink-3">:</span>
                  <input
                    name="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="emojinavn"
                    className="w-full bg-transparent py-2 text-sm text-ink outline-none placeholder:text-ink-3"
                  />
                  <span className="text-sm text-ink-3">:</span>
                </span>
              </label>

              <label className="flex-1">
                <span className="label">Bilde</span>
                <input
                  type="file"
                  name="file"
                  accept="image/png,image/gif,image/webp"
                  onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
                  className="mt-1.5 block w-full rounded-[5px] border border-line-2 bg-surface px-3 py-[7px] text-[13px] text-ink-2 file:mr-3 file:rounded-[4px] file:border-0 file:bg-paper-2 file:px-2 file:py-1 file:text-[13px] file:text-ink"
                />
              </label>
            </div>

            {state.status === "error" ? (
              <p
                role="alert"
                className="rounded-[5px] border border-rust/25 bg-rust-soft px-3 py-2 text-[13px] text-rust"
              >
                {state.message}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <Submit
                label="Legg til"
                pendingLabel="Laster opp …"
                disabled={!preview || !fileName}
                className="h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-30"
                style={{ backgroundColor: accent }}
              />
              {preview ? (
                <span className="text-[13px] text-ink-3">
                  Blir tilgjengelig som <span className="text-ink">:{preview}:</span>
                </span>
              ) : null}
            </div>
          </form>
        </Panel>
      ) : null}

      <section>
        <h2 className="label mb-4">
          {emojis.length} {emojis.length === 1 ? "egen emoji" : "egne emojier"}
        </h2>

        {emojis.length === 0 ? (
          <EmptyState
            title="Ingen egne emojier ennå"
            body={
              canManage
                ? "Legg til den første over. Den blir umiddelbart tilgjengelig i reaksjonsvelgeren for alle medlemmer her."
                : "Moderatorer og administratorer kan legge til emojier for dette fellesskapet."
            }
          />
        ) : (
          <Panel className="divide-y divide-line">
            {emojis.map((emoji) => (
              <div key={emoji.id} className="flex items-center gap-4 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[5px] bg-paper-2">
                  {emoji.url ? (
                    <Image
                      src={emoji.url}
                      alt={`:${emoji.name}:`}
                      width={24}
                      height={24}
                      unoptimized
                      className="object-contain"
                      style={{ width: 24, height: 24 }}
                    />
                  ) : (
                    <span className="text-[10px] text-ink-3">?</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[13px] text-ink">
                    :{emoji.name}:
                  </span>
                  <span className="block truncate text-[11px] text-ink-3">
                    Lagt til av {authors[emoji.createdBy]?.name ?? "et medlem"} ·{" "}
                    {formatFullDate(emoji.createdAt)}
                  </span>
                </span>
                {canManage ? <DeleteEmoji emoji={emoji} communityId={communityId} /> : null}
              </div>
            ))}
          </Panel>
        )}
      </section>
    </div>
  );
}
