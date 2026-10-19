"use client";

import { useId, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearDirectConversationHistoryAction, hideDirectConversationAction } from "@/app/actions";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconInboxOut, IconMore, IconTrash } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/react";

/**
 * The "⋯" for one direct conversation, wherever it is listed or open: the
 * sidebar, «Alle meldinger» and the conversation's own header.
 *
 *   Fjern fra innboksen     at once, no dialog: it only tidies the caller's
 *                           own inbox, and the next message brings it back.
 *   Slett samtalehistorikk  destructive, confirmed first, with what it does
 *                           and does not do.
 *
 * Presentation only. Each action sends the conversation id and nothing else;
 * the database decides whether the caller is in it and changes only their
 * own state (20261104100000).
 */
export function DirectConversationMenu({
  communityId,
  conversationId,
  otherName,
  reveal = "hover",
  className,
  triggerClassName,
}: {
  communityId: string;
  conversationId: string;
  otherName: string;
  /** `hover`: shown on hover and focus, always on touch screens. `always`: e.g. a header. */
  reveal?: "hover" | "always";
  className?: string;
  triggerClassName?: string;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const inbox = `/community/${communityId}/messages`;

  /** Off the conversation's own page and the inbox, a refresh is enough. */
  function after(status: "hidden" | "cleared") {
    if (pathname === inbox || pathname === `${inbox}/${conversationId}`) {
      router.replace(`${inbox}?status=${status}`);
    } else {
      router.refresh();
      // The row this menu sat in is gone; keep focus somewhere sensible.
      document.querySelector<HTMLElement>(`a[href="${inbox}"]`)?.focus();
    }
  }

  function hide() {
    if (pending) return;
    setNotice(undefined);
    startTransition(async () => {
      const result = await hideDirectConversationAction(communityId, conversationId);
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      after("hidden");
    });
  }

  function clear() {
    if (pending) return;
    startTransition(async () => {
      const result = await clearDirectConversationHistoryAction(communityId, conversationId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      after("cleared");
    });
  }

  return (
    <div
      className={cn(
        reveal === "hover" &&
          "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
    >
      <ActionMenu
        label={t("dm.actions")}
        ariaLabel={t("dm.actionsFor", { name: otherName })}
        align="right"
        triggerRef={triggerRef}
        items={[
          {
            key: "hide",
            label: t("dm.hide"),
            icon: <IconInboxOut size={15} />,
            onSelect: hide,
          },
          {
            key: "clear",
            label: t("dm.clear"),
            icon: <IconTrash size={15} />,
            danger: true,
            separatorBefore: true,
            onSelect: () => {
              setError(undefined);
              setConfirming(true);
            },
          },
        ]}
        triggerClassName={cn(
          "flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink aria-expanded:bg-paper-2 aria-expanded:text-ink",
          triggerClassName,
        )}
        trigger={() => <IconMore size={16} />}
      />
      {notice ? (
        <p role="alert" className="sr-only">
          {notice}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        labelledBy={titleId}
        onClose={() => {
          if (pending) return;
          setConfirming(false);
          triggerRef.current?.focus();
        }}
      >
        <h3 id={titleId} className="font-display text-lg text-ink">
          {t("dm.clear.title")}
        </h3>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2">
          <li>{t("dm.clear.mine", { name: otherName })}</li>
          <li>{t("dm.clear.other", { name: otherName })}</li>
          <li>{t("dm.clear.future")}</li>
          <li className="font-medium text-ink">{t("dm.clear.undo")}</li>
        </ul>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-rust">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              triggerRef.current?.focus();
            }}
            disabled={pending}
            className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2 disabled:opacity-40"
          >
            {t("message.cancel")}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="h-9 rounded-[5px] bg-rust px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {pending ? t("dm.clear.pending") : t("dm.clear.confirm")}
          </button>
        </div>
      </ConfirmDialog>
    </div>
  );
}
