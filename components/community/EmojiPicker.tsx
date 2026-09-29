"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import Image from "next/image";
import { IconSearch, IconSmile } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import { reactionPalette } from "@/lib/comment-form";
import { emojiMatchesQuery, emojiToken, insertAtSelection, splitEmojiText } from "@/lib/emoji-text";
import { useT } from "@/lib/i18n/react";
import type { CommunityEmoji } from "@/lib/types";

/**
 * The emoji picker shared by reactions and the message composers.
 *
 * One catalogue (`reactionPalette` plus a community's custom emojis), one
 * search, one look. What differs is only what a pick *does*, which the caller
 * supplies: a reaction submits a form, a composer inserts text.
 */

/** A custom emoji image, or its `:name:` if there is no URL or it fails to load. */
export function CustomEmoji({ name, url, size = 16 }: { name: string; url?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="text-[11px] text-ink-3">:{name}:</span>;
  return (
    <Image
      src={url}
      alt={`:${name}:`}
      title={`:${name}:`}
      width={size}
      height={size}
      unoptimized
      onError={() => setFailed(true)}
      className="inline-block object-contain align-text-bottom"
      style={{ width: size, height: size }}
    />
  );
}

export type EmojiChoice = { emoji: string } | { emojiId: string; name: string };

/**
 * The picker's contents. `customEmojis` undefined means custom emojis are not
 * offered here at all (as opposed to an empty catalogue, which explains itself).
 */
export function EmojiPickerPanel({
  customEmojis,
  excludeUnicode,
  excludeCustomIds,
  onPick,
  className,
}: {
  customEmojis?: CommunityEmoji[];
  excludeUnicode?: ReadonlySet<string | null>;
  excludeCustomIds?: ReadonlySet<string | null>;
  onPick: (choice: EmojiChoice) => void;
  className?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState("");

  const builtIn = reactionPalette.filter((emoji) => !excludeUnicode?.has(emoji));
  const matchingCustom = (customEmojis ?? []).filter(
    (emoji) => !excludeCustomIds?.has(emoji.id) && emojiMatchesQuery(emoji.name, query),
  );

  return (
    <div
      className={cn(
        "w-64 max-w-[calc(100vw-2.5rem)] rounded-[6px] border border-line-2 bg-surface p-3 shadow-[0_12px_32px_-12px_rgba(23,25,26,0.28)]",
        className,
      )}
    >
      <p className="label mb-2">{t("reaction.default")}</p>
      <div className="flex flex-wrap gap-1.5">
        {builtIn.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick({ emoji })}
            className="rounded-[5px] px-1.5 py-1 text-base transition-colors hover:bg-paper-2"
            aria-label={emoji}
          >
            {emoji}
          </button>
        ))}
        {builtIn.length === 0 ? (
          <span className="text-xs text-ink-3">{t("reaction.allUsed")}</span>
        ) : null}
      </div>

      {customEmojis ? (
        <>
          <p className="label mb-2 mt-4">{t("reaction.communityOwn")}</p>
          {customEmojis.length === 0 ? (
            <p className="text-xs leading-relaxed text-ink-3">{t("reaction.noneYet")}</p>
          ) : (
            <>
              <label className="mb-2 flex items-center gap-1.5 rounded-[5px] border border-line px-2 py-1">
                <IconSearch size={12} className="shrink-0 text-ink-3" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("common.search")}
                  aria-label={t("common.search")}
                  className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-3"
                />
              </label>
              <div className="scroll-quiet flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {matchingCustom.map((emoji) => (
                  <button
                    key={emoji.id}
                    type="button"
                    onClick={() => onPick({ emojiId: emoji.id, name: emoji.name })}
                    title={emojiToken(emoji.name)}
                    aria-label={emojiToken(emoji.name)}
                    className="rounded-[5px] p-1 transition-colors hover:bg-paper-2"
                  >
                    <CustomEmoji name={emoji.name} url={emoji.url} size={20} />
                  </button>
                ))}
                {matchingCustom.length === 0 ? (
                  <span className="text-xs text-ink-3">{t("reaction.noMatches")}</span>
                ) : null}
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * A message body with this community's custom emoji tokens shown as images.
 *
 * Built from React nodes only — nothing is parsed as markup, so the text a
 * person wrote can never become elements. Tokens that are not in `emojis`
 * stay as the literal text they were written as.
 */
export function EmojiText({ body, emojis }: { body: string; emojis?: CommunityEmoji[] }) {
  const byName = useMemo(() => new Map((emojis ?? []).map((emoji) => [emoji.name, emoji])), [emojis]);
  if (byName.size === 0) return <>{body}</>;

  return (
    <>
      {splitEmojiText(body, new Set(byName.keys())).map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <CustomEmoji
            key={index}
            name={segment.name}
            url={byName.get(segment.name)?.url}
            size={20}
          />
        ),
      )}
    </>
  );
}

/**
 * Inserts text into a controlled textarea at its caret (or over its selection)
 * and puts the caret after it. Falls back to appending when the textarea has
 * never been focused.
 */
export function useComposerInsert(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  setValue: (next: string) => void,
) {
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    const caret = pendingCaret.current;
    const el = textareaRef.current;
    if (caret === null || !el) return;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value, textareaRef]);

  return useCallback(
    (text: string) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? value.length;
      const next = insertAtSelection(value, start, end, text);
      pendingCaret.current = next.caret;
      setValue(next.value);
    },
    [textareaRef, value, setValue],
  );
}

/**
 * The quiet smile button beside a composer, and its popover.
 *
 * Closes on an outside press or Escape (returning focus to the composer) and
 * after a pick, and never submits anything: a pick only calls `onInsert`.
 */
export function ComposerEmojiButton({
  customEmojis,
  onInsert,
  textareaRef,
  disabled,
  className,
  align = "end",
}: {
  customEmojis?: CommunityEmoji[];
  onInsert: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  className?: string;
  /**
   * Which edge of the button the popover lines up with. `end` suits a button at
   * the right of a composer (chat); `start` one on the left (comments), which
   * on a phone is centred above the tab bar, since it can sit anywhere along
   * a card's width.
   */
  align?: "start" | "end";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      textareaRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, textareaRef]);

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        aria-label={t("emoji.insert")}
        title={t("emoji.insert")}
        className="rounded-[5px] p-2 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink disabled:opacity-30"
      >
        <IconSmile size={18} />
      </button>

      {open ? (
        <EmojiPickerPanel
          customEmojis={customEmojis}
          className={cn(
            "absolute bottom-[calc(100%+8px)] z-50",
            align === "end"
              ? "right-0"
              : "left-0 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-24 max-sm:mx-auto",
          )}
          onPick={(choice) => {
            onInsert("emoji" in choice ? choice.emoji : `${emojiToken(choice.name)} `);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
