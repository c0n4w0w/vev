"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { reactionAuthorsAction, setReactionAction, type ReactionChoice, type ReactionTarget } from "@/app/reaction-actions";
import { CustomEmoji, EmojiPickerPopover, type EmojiChoice } from "@/components/community/EmojiPicker";
import { AnchoredLayer } from "@/components/ui/AnchoredLayer";
import { IconSmilePlus } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import { tn } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/react";
import type { CommunityEmoji, Reaction, ReactionAuthors } from "@/lib/types";

/**
 * Reactions under a post, channel message or direct message: one chip per
 * emoji with its count, and a button that opens the shared picker.
 *
 * A chip is yours or not (aria-pressed, the community's accent); pressing it
 * adds or withdraws your reaction. The count changes at once and is then
 * replaced by what the database reports. Each request carries the state asked
 * for rather than "toggle", and only the latest answer is shown, so double
 * clicks and crossing requests settle on what was last asked.
 *
 * Who reacted: hovering a chip (with a mouse), focusing it, pressing and
 * holding it (touch) or opening its context menu shows a small tooltip. The
 * names are asked for at that moment and only when the page says names are
 * offered here (`authorsVisible`); otherwise it shows the count alone. Either
 * way reaction_authors() decides again — the page never holds anyone's
 * identity it may not show.
 */

type Scope = { communityId: string; channelId?: string; conversationId?: string };

function keyOf(reaction: { emoji: string | null; emojiId: string | null }) {
  return reaction.emojiId ? `c:${reaction.emojiId}` : `u:${reaction.emoji}`;
}

function choiceKey(choice: EmojiChoice) {
  return "emojiId" in choice ? { emoji: null, emojiId: choice.emojiId } : { emoji: choice.emoji, emojiId: null };
}

function applyLocally(reactions: Reaction[], choice: EmojiChoice | Reaction, on: boolean): Reaction[] {
  const emojiId = "emojiId" in choice ? choice.emojiId : null;
  const emoji = "emoji" in choice && !emojiId ? choice.emoji : null;
  const key = keyOf({ emoji, emojiId });
  const existing = reactions.find((reaction) => keyOf(reaction) === key);
  if (!existing) {
    if (!on) return reactions;
    return [...reactions, { emoji, emojiId, name: "name" in choice ? choice.name : null, count: 1, mine: true }];
  }
  if (existing.mine === on) return reactions;
  return reactions
    .map((reaction) =>
      keyOf(reaction) === key ? { ...reaction, mine: on, count: reaction.count + (on ? 1 : -1) } : reaction,
    )
    .filter((reaction) => reaction.count > 0);
}

/** "Du, Mia og 3 andre" — at most ten names, the rest counted. */
function namesSentence(t: ReturnType<typeof useT>, locale: ReturnType<typeof useLocale>, authors: Extract<ReactionAuthors, { visible: true }>) {
  const shown = authors.people.slice(0, 10).map((person) => (person.me ? t("reaction.who.you") : person.name));
  const rest = authors.people.length - shown.length + authors.unnamed;
  const parts = rest > 0 ? [...shown, tn(locale, "reaction.who.others", rest)] : shown;
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return t("reaction.who.and", { first: parts.slice(0, -1).join(", "), last: parts[parts.length - 1] });
}

function ReactionChip({
  reaction,
  target,
  custom,
  accent,
  canReact,
  authorsVisible,
  onToggle,
}: {
  reaction: Reaction;
  target: ReactionTarget;
  custom?: CommunityEmoji;
  accent: string;
  canReact: boolean;
  authorsVisible: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const tooltipId = useId();
  const chipRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [authors, setAuthors] = useState<{ key: string; value?: ReactionAuthors; failed?: boolean }>();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);

  const display = reaction.emoji ?? `:${custom?.name ?? reaction.name ?? "emoji"}:`;
  const askedFor = `${reaction.count}|${reaction.mine}`;

  const { kind, id } = target;
  const { emoji, emojiId } = reaction;
  useEffect(() => {
    if (!open || !authorsVisible || authors?.key === askedFor) return;
    let live = true;
    reactionAuthorsAction({ kind, id }, emojiId ? { emojiId } : { emoji: emoji! }).then(
      (value) => live && setAuthors({ key: askedFor, value, failed: !value }),
      () => live && setAuthors({ key: askedFor, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [open, authorsVisible, askedFor, authors?.key, kind, id, emoji, emojiId]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!chipRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => () => {
    clearTimeout(hoverTimer.current);
    clearTimeout(pressTimer.current);
  }, []);

  const count = tn(locale, "reaction.count", reaction.count);
  const summary = reaction.mine ? `${count}, ${t("reaction.includingYours")}` : count;
  const current = authors?.key === askedFor ? authors : undefined;

  let body: ReactNode;
  if (!authorsVisible) {
    body = (
      <>
        <span className="block">{summary}</span>
        {target.kind !== "direct" ? <span className="mt-0.5 block text-white/70">{t("reaction.who.hiddenStaff")}</span> : null}
      </>
    );
  } else if (!current) {
    body = t("reaction.who.loading");
  } else if (current.failed || !current.value) {
    body = t("reaction.who.failed");
  } else if (!current.value.visible) {
    body = (
      <>
        <span className="block">{summary}</span>
        <span className="mt-0.5 block text-white/70">{t("reaction.who.hiddenStaff")}</span>
      </>
    );
  } else {
    body = t("reaction.who.reacted", { names: namesSentence(t, locale, current.value), emoji: display });
  }

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        aria-pressed={reaction.mine}
        aria-disabled={canReact ? undefined : true}
        aria-label={`${display} ${summary}`}
        aria-describedby={open ? tooltipId : undefined}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (canReact) onToggle();
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          clearTimeout(hoverTimer.current);
          hoverTimer.current = setTimeout(() => setOpen(true), 350);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse") return;
          clearTimeout(hoverTimer.current);
          setOpen(false);
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          clearTimeout(pressTimer.current);
          pressTimer.current = setTimeout(() => {
            suppressClick.current = true;
            setOpen(true);
          }, 450);
        }}
        onPointerUp={() => clearTimeout(pressTimer.current)}
        onPointerCancel={() => clearTimeout(pressTimer.current)}
        onContextMenu={(event) => {
          event.preventDefault();
          clearTimeout(pressTimer.current);
          setOpen(true);
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        className={cn(
          "inline-flex h-7 select-none items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors [-webkit-touch-callout:none]",
          reaction.mine ? "font-medium text-ink" : "border-line bg-paper text-ink-2",
          canReact && !reaction.mine && "hover:border-line-2",
          !canReact && "cursor-default",
        )}
        style={reaction.mine ? { borderColor: accent, backgroundColor: `${accent}1f` } : undefined}
      >
        {reaction.emoji ? (
          <span aria-hidden="true" className="text-[0.95rem] leading-none">
            {reaction.emoji}
          </span>
        ) : (
          <span aria-hidden="true">
            <CustomEmoji name={custom?.name ?? reaction.name ?? "emoji"} url={custom?.url} />
          </span>
        )}
        <span aria-hidden="true">{reaction.count}</span>
      </button>

      {open ? (
        <AnchoredLayer
          anchorRef={chipRef}
          align="center"
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none z-[80] max-w-[min(16rem,calc(100vw-1rem))] rounded-[5px] bg-ink px-2.5 py-1.5 text-[12px] leading-snug text-white shadow-lg"
        >
          <span aria-live="polite">{body}</span>
        </AnchoredLayer>
      ) : null}
    </>
  );
}

export function ReactionRow({
  target,
  scope,
  reactions: initial,
  customEmojis,
  accent,
  canReact = true,
  authorsVisible,
  emptyButtonClassName,
  align = "start",
  className,
}: {
  target: ReactionTarget;
  scope: Scope;
  reactions: Reaction[];
  /** The parent community's own emojis — for the picker and for drawing chips. */
  customEmojis?: CommunityEmoji[];
  accent: string;
  /** False where the conversation takes no reactions now (archived, ended). */
  canReact?: boolean;
  /** Whether names are offered here; the database decides again on each request. */
  authorsVisible: boolean;
  /**
   * Chat: with no reactions yet, nothing is drawn under the message; the add
   * button alone sits where this class puts it (the message's hover toolbar)
   * — shown on hover or focus, and always on a touch screen.
   */
  emptyButtonClassName?: string;
  align?: "start" | "end";
  className?: string;
}) {
  const t = useT();
  const [reactions, setReactions] = useState(initial);
  const [error, setError] = useState<string>();
  const [picking, setPicking] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const latest = useRef(0);
  const confirmed = useRef(initial);
  const [inFlight, setInFlight] = useState(0);

  // A newer read from the server (a refresh) wins, unless a request of ours
  // is still on its way — its answer is newer than that read.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    if (inFlight === 0) setReactions(initial);
  }
  useEffect(() => {
    confirmed.current = initial;
  }, [initial]);

  const emojiById = new Map((customEmojis ?? []).map((emoji) => [emoji.id, emoji]));
  const mineKeys = new Set(reactions.filter((reaction) => reaction.mine).map(keyOf));

  const send = useCallback(
    (choice: EmojiChoice | Reaction, on: boolean) => {
      const request = ++latest.current;
      setInFlight((count) => count + 1);
      setError(undefined);
      setReactions((current) => applyLocally(current, choice, on));
      const wire: ReactionChoice =
        "emojiId" in choice && choice.emojiId ? { emojiId: choice.emojiId } : { emoji: (choice as { emoji: string }).emoji };
      setReactionAction(scope, target, wire, on)
        .then((result) => {
          if (result.ok) confirmed.current = result.reactions;
          if (request !== latest.current) return;
          if (result.ok) setReactions(result.reactions);
          else {
            setReactions(confirmed.current);
            setError(result.error);
          }
        })
        .catch(() => {
          if (request === latest.current) setReactions(confirmed.current);
        })
        .finally(() => setInFlight((count) => count - 1));
    },
    [scope, target],
  );

  const closePicker = useCallback(() => setPicking(false), []);

  if (reactions.length === 0 && !canReact) return null;

  const empty = reactions.length === 0 && emptyButtonClassName !== undefined;
  const addButton = canReact ? (
    <>
      <button
        ref={addRef}
        type="button"
        onClick={() => setPicking((value) => !value)}
        aria-expanded={picking}
        aria-haspopup="dialog"
        aria-label={t("reaction.add")}
        title={t("reaction.add")}
        className={cn(
          empty
            ? cn(
                "flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-3 transition hover:bg-paper-2 hover:text-ink aria-expanded:bg-paper-2 aria-expanded:text-ink",
                "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100",
                emptyButtonClassName,
              )
            : "inline-flex h-7 items-center justify-center rounded-full border border-dashed border-line-2 px-2 text-ink-3 transition hover:border-ink-3 hover:text-ink aria-expanded:text-ink",
        )}
      >
        <IconSmilePlus size={15} />
      </button>
      <EmojiPickerPopover
        open={picking}
        onClose={closePicker}
        anchorRef={addRef}
        align={align}
        customEmojis={customEmojis}
        isSelected={(choice) => mineKeys.has(keyOf(choiceKey(choice)))}
        onPick={(choice) => send(choice, !mineKeys.has(keyOf(choiceKey(choice))))}
      />
    </>
  ) : null;

  if (empty) {
    return (
      <>
        {addButton}
        {error ? (
          <span role="alert" className="mt-1 block text-xs text-rust">
            {error}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", align === "end" && "justify-end", className)}>
      {reactions.map((reaction) => (
        <ReactionChip
          key={keyOf(reaction)}
          reaction={reaction}
          target={target}
          custom={reaction.emojiId ? emojiById.get(reaction.emojiId) : undefined}
          accent={accent}
          canReact={canReact}
          authorsVisible={authorsVisible}
          onToggle={() => send(reaction, !reaction.mine)}
        />
      ))}
      {addButton}
      {error ? (
        <span role="alert" className="text-xs text-rust">
          {error}
        </span>
      ) : null}
    </div>
  );
}
