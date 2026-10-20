"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import Image from "next/image";
import { AnchoredLayer } from "@/components/ui/AnchoredLayer";
import { IconSearch, IconSmile } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import { canonicalEmoji } from "@/lib/emoji/canonical";
import { loadEmojiCatalog } from "@/lib/emoji/load";
import { searchEmojiEntries } from "@/lib/emoji/search";
import { EMOJI_GROUPS, QUICK_REACTIONS, type EmojiCatalog, type EmojiCatalogEntry } from "@/lib/emoji/types";
import { emojiMatchesQuery, emojiToken, insertAtSelection, splitEmojiText } from "@/lib/emoji-text";
import { useLocale, useT } from "@/lib/i18n/react";
import type { CommunityEmoji } from "@/lib/types";

/**
 * The one emoji picker, shared by reactions (feed, channels, groups, direct
 * messages) and the message composers.
 *
 *   Search          the whole Unicode list and this community's own emojis
 *   Quick reactions ❤️ 👍 👏 😂 🎉 🔥, then this community's own emojis
 *   All emojis      the Unicode list by category
 *
 * The Unicode list is Emojibase's (lib/emoji/catalog.ts), fetched the first
 * time a picker opens. Nothing is remembered between picks: there is no
 * "frequently used" and no skin-tone preference. Custom emojis are only ever
 * the ones the page was given for its own community.
 *
 * Keyboard: the search field takes focus (where there is a mouse); ↓ moves
 * into the emojis, arrows move between them, Enter picks, Escape closes.
 * What differs between callers is only what a pick does.
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

function useEmojiCatalog() {
  const locale = useLocale();
  const [state, setState] = useState<{ catalog?: EmojiCatalog; failed?: boolean }>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadEmojiCatalog(locale).then(
      (catalog) => live && setState({ catalog }),
      () => live && setState({ failed: true }),
    );
    return () => {
      live = false;
    };
  }, [locale, attempt]);

  return {
    ...state,
    retry: () => {
      setState({});
      setAttempt((value) => value + 1);
    },
  };
}

/** One emoji button. All of them sit in one roving-focus grid. */
function Cell({
  label,
  selected,
  first,
  onPick,
  children,
}: {
  label: string;
  selected?: boolean;
  first?: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <button
      type="button"
      data-emoji-cell=""
      tabIndex={first ? 0 : -1}
      onClick={onPick}
      title={label}
      aria-label={selected ? `${label} (${t("emoji.selected")})` : label}
      aria-pressed={selected}
      className={cn(
        "flex h-9 w-full items-center justify-center rounded-[5px] text-[1.3rem] leading-none transition-colors",
        "hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink-3",
        selected && "bg-paper-2 ring-1 ring-inset ring-line-2",
      )}
    >
      {children}
    </button>
  );
}

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="pb-2">
      <p className="label sticky top-0 z-[1] bg-surface px-1 pb-1.5 pt-2">{title}</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-0.5">{children}</div>
    </section>
  );
}

/** Moves focus between emoji cells by arrow key, by what is visually adjacent. */
function moveFocus(container: HTMLElement, event: ReactKeyboardEvent, onLeaveTop: () => void): boolean {
  const cells = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-emoji-cell]"));
  const index = cells.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return false;

  let next: number | undefined;
  if (event.key === "ArrowRight") next = Math.min(index + 1, cells.length - 1);
  else if (event.key === "ArrowLeft") next = Math.max(index - 1, 0);
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = cells.length - 1;
  else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const here = cells[index].getBoundingClientRect();
    const down = event.key === "ArrowDown";
    const row = (rect: DOMRect) => (down ? rect.top > here.top + 4 : rect.top < here.top - 4);
    const rects = cells.map((cell) => cell.getBoundingClientRect());
    const candidates = rects.map((rect, i) => ({ rect, i })).filter(({ rect }) => row(rect));
    if (candidates.length === 0) {
      if (!down) onLeaveTop();
      return true;
    }
    const rowTop = down
      ? Math.min(...candidates.map(({ rect }) => rect.top))
      : Math.max(...candidates.map(({ rect }) => rect.top));
    const inRow = candidates.filter(({ rect }) => Math.abs(rect.top - rowTop) < 4);
    const centre = here.left + here.width / 2;
    next = inRow.reduce((best, item) =>
      Math.abs(item.rect.left + item.rect.width / 2 - centre) < Math.abs(best.rect.left + best.rect.width / 2 - centre)
        ? item
        : best,
    ).i;
  } else {
    return false;
  }

  cells[index].tabIndex = -1;
  const target = cells[next];
  target.tabIndex = 0;
  target.focus();
  target.scrollIntoView({ block: "nearest" });
  return true;
}

/**
 * The picker's contents. `customEmojis` undefined means custom emojis are not
 * offered here at all (as opposed to an empty catalogue).
 */
export function EmojiPickerPanel({
  customEmojis,
  isSelected,
  onPick,
  className,
}: {
  customEmojis?: CommunityEmoji[];
  /** Marks the choices that are already yours (a reaction you gave). */
  isSelected?: (choice: EmojiChoice) => boolean;
  onPick: (choice: EmojiChoice) => void;
  className?: string;
}) {
  const t = useT();
  const { catalog, failed, retry } = useEmojiCatalog();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Not on a touch screen: focusing the field there opens the keyboard
    // over the very list it is meant to search.
    if (window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus();
  }, []);

  const labels = useMemo(() => new Map(catalog?.entries.map((entry) => [entry[0], entry[2]]) ?? []), [catalog]);
  const groups = useMemo(() => {
    const byGroup = new Map<number, EmojiCatalogEntry[]>();
    for (const entry of catalog?.entries ?? []) {
      const list = byGroup.get(entry[1]) ?? [];
      list.push(entry);
      byGroup.set(entry[1], list);
    }
    return EMOJI_GROUPS.map((group) => ({ ...group, entries: byGroup.get(group.id) ?? [] })).filter(
      (group) => group.entries.length > 0,
    );
  }, [catalog]);

  const searching = query.trim().length > 0;
  const unicodeResults = useMemo(
    () => (searching && catalog ? searchEmojiEntries(catalog.entries, query) : []),
    [searching, catalog, query],
  );
  const customResults = searching
    ? (customEmojis ?? []).filter((emoji) => emojiMatchesQuery(emoji.name, query.trim().replace(/^:|:$/g, "")))
    : [];

  const unicode = (emoji: string, label?: string, first?: boolean) => {
    const choice = { emoji: canonicalEmoji(emoji) };
    return (
      <Cell
        key={`u-${emoji}`}
        first={first}
        label={label ?? labels.get(emoji) ?? emoji}
        selected={isSelected?.(choice)}
        onPick={() => onPick(choice)}
      >
        <span aria-hidden="true">{emoji}</span>
      </Cell>
    );
  };
  const custom = (emoji: CommunityEmoji, first?: boolean) => {
    const choice = { emojiId: emoji.id, name: emoji.name };
    return (
      <Cell
        key={`c-${emoji.id}`}
        first={first}
        label={emojiToken(emoji.name)}
        selected={isSelected?.(choice)}
        onPick={() => onPick(choice)}
      >
        <CustomEmoji name={emoji.name} url={emoji.url} size={22} />
      </Cell>
    );
  };

  function pickFirstResult() {
    if (customResults[0]) onPick({ emojiId: customResults[0].id, name: customResults[0].name });
    else if (unicodeResults[0]) onPick({ emoji: canonicalEmoji(unicodeResults[0][0]) });
  }

  function focusFirstCell() {
    const first = gridRef.current?.querySelector<HTMLButtonElement>("[data-emoji-cell]");
    if (!first) return;
    for (const cell of gridRef.current!.querySelectorAll<HTMLButtonElement>("[data-emoji-cell]")) cell.tabIndex = -1;
    first.tabIndex = 0;
    first.focus();
  }

  function jumpTo(groupKey: string) {
    setQuery("");
    requestAnimationFrame(() => {
      const section = gridRef.current?.querySelector<HTMLElement>(`#emoji-group-${groupKey}`);
      if (section && gridRef.current) gridRef.current.scrollTop = section.offsetTop - gridRef.current.offsetTop;
    });
  }

  return (
    <div
      className={cn(
        "flex w-[20rem] max-w-[calc(100vw-1rem)] flex-col rounded-[6px] border border-line-2 bg-surface shadow-[0_12px_32px_-12px_rgba(23,25,26,0.28)]",
        className,
      )}
    >
      <div className="p-2 pb-1.5">
        <label className="flex items-center gap-1.5 rounded-[5px] border border-line px-2 py-1.5 focus-within:border-ink-3">
          <IconSearch size={13} className="shrink-0 text-ink-3" />
          <input
            ref={searchRef}
            value={query}
            type="search"
            enterKeyHint="done"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusFirstCell();
              } else if (event.key === "Enter") {
                event.preventDefault();
                pickFirstResult();
              }
            }}
            placeholder={t("emoji.search")}
            aria-label={t("emoji.search")}
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      </div>

      {!searching && catalog ? (
        <div
          role="toolbar"
          aria-label={t("emoji.categories")}
          className="flex justify-between gap-0.5 border-b border-line px-2 pb-1.5"
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
            buttons.forEach((button) => (button.tabIndex = -1));
            next.tabIndex = 0;
            next.focus();
            event.preventDefault();
          }}
        >
          {groups.map((group, index) => (
            <button
              key={group.key}
              type="button"
              tabIndex={index === 0 ? 0 : -1}
              onClick={() => jumpTo(group.key)}
              title={t(`emoji.group.${group.key}`)}
              aria-label={t(`emoji.group.${group.key}`)}
              className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[0.95rem] grayscale transition hover:bg-paper-2 hover:grayscale-0 focus-visible:grayscale-0"
            >
              <span aria-hidden="true">{group.entries[0][0]}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={gridRef}
        className="scroll-quiet relative h-[min(17rem,calc(100dvh-12rem))] overflow-y-auto px-2 pb-2"
        onKeyDown={(event) => {
          if (moveFocus(event.currentTarget, event, () => searchRef.current?.focus())) event.preventDefault();
        }}
      >
        {searching ? (
          <Section title={t("emoji.results")}>
            {customResults.map((emoji, index) => custom(emoji, index === 0))}
            {unicodeResults.map((entry, index) => unicode(entry[0], entry[2], customResults.length === 0 && index === 0))}
            {customResults.length === 0 && unicodeResults.length === 0 ? (
              <p className="col-span-full px-1 py-2 text-xs text-ink-3">
                {catalog || failed ? t("reaction.noMatches") : t("emoji.loading")}
              </p>
            ) : null}
          </Section>
        ) : (
          <>
            <Section title={t("emoji.quick")}>
              {QUICK_REACTIONS.map((emoji, index) => unicode(emoji, undefined, index === 0))}
              {(customEmojis ?? []).map((emoji) => custom(emoji))}
            </Section>

            {failed ? (
              <p className="px-1 py-3 text-xs text-ink-3">
                {t("emoji.loadFailed")}{" "}
                <button type="button" onClick={retry} className="underline hover:text-ink">
                  {t("emoji.retry")}
                </button>
              </p>
            ) : !catalog ? (
              <p role="status" className="px-1 py-3 text-xs text-ink-3">
                {t("emoji.loading")}
              </p>
            ) : (
              <>
                <h3 className="sr-only">{t("emoji.all")}</h3>
                {groups.map((group) => (
                  <Section key={group.key} id={`emoji-group-${group.key}`} title={t(`emoji.group.${group.key}`)}>
                    {group.entries.map((entry) => unicode(entry[0], entry[2]))}
                  </Section>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The picker as a popover next to the button that opened it. Closes on an
 * outside press, on Escape (handing focus to `returnFocusRef`, or back to the
 * button) and after a pick.
 */
export function EmojiPickerPopover({
  anchorRef,
  open,
  onClose,
  align = "start",
  returnFocusRef,
  ...panel
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  align?: "start" | "end";
  returnFocusRef?: RefObject<HTMLElement | null>;
} & Parameters<typeof EmojiPickerPanel>[0]) {
  const t = useT();
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (layerRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    // On the document, not the layer: on a touch screen focus stays on the
    // button that opened it.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
      (returnFocusRef?.current ?? anchorRef.current)?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, anchorRef, returnFocusRef]);

  if (!open) return null;
  return (
    <AnchoredLayer
      anchorRef={anchorRef}
      layerRef={layerRef}
      align={align}
      role="dialog"
      aria-label={t("emoji.picker")}
      className="z-[70]"
    >
      <EmojiPickerPanel
        {...panel}
        onPick={(choice) => {
          panel.onPick(choice);
          onClose();
        }}
      />
    </AnchoredLayer>
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
 * The quiet smile button beside a composer, and its picker.
 *
 * A pick only calls `onInsert` — a Unicode emoji as itself, a custom one as
 * its `:name:` token — and never submits anything. Escape hands focus back to
 * the composer.
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
  /** Which edge of the button the picker lines up with. */
  align?: "start" | "end";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className={cn("relative shrink-0", className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("emoji.insert")}
        title={t("emoji.insert")}
        className="rounded-[5px] p-2 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink disabled:opacity-30"
      >
        <IconSmile size={18} />
      </button>

      <EmojiPickerPopover
        open={open}
        onClose={close}
        anchorRef={buttonRef}
        returnFocusRef={textareaRef}
        align={align}
        customEmojis={customEmojis}
        onPick={(choice) => onInsert("emoji" in choice ? choice.emoji : `${emojiToken(choice.name)} `)}
      />
    </div>
  );
}
