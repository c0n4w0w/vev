"use client";

import { useId, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  archiveDirectConversationAction,
  deleteDirectConversationAction,
  restoreDirectConversationAction,
} from "@/app/actions";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconInboxIn, IconInboxOut, IconMore, IconTrash } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import { showToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/react";

/**
 * The "⋯" for one direct conversation, wherever it is listed or open: the
 * sidebar, the inbox and archive on the messages page, and the
 * conversation's own header.
 *
 *   Arkiver samtale / Gjenopprett samtale
 *                   at once, no dialog: it only moves the conversation
 *                   between the caller's own inbox and archive.
 *   Slett samtale   destructive, confirmed first, with what it does and
 *                   does not do.
 *
 * Presentation only. Each action sends the conversation id and nothing else;
 * the database decides whether the caller is in it and changes only their
 * own state (20261105100000). A short notice confirms what happened.
 */
export function DirectConversationMenu({
  communityId,
  conversationId,
  otherName,
  archived = false,
  restoreInMenu = true,
  reveal = "hover",
  className,
  triggerClassName,
}: {
  communityId: string;
  conversationId: string;
  otherName: string;
  /** In the viewer's archive: offers «Gjenopprett» instead of «Arkiver». */
  archived?: boolean;
  /** False where a visible «Gjenopprett» button already sits beside the menu. */
  restoreInMenu?: boolean;
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
  const [pending, startTransition] = useTransition();
  const move = useMoveConversation(communityId, conversationId);

  const inbox = `/community/${communityId}/messages`;

  function remove() {
    if (pending) return;
    startTransition(async () => {
      const result = await deleteDirectConversationAction(communityId, conversationId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      showToast(t("dm.done.deleted"));
      if (pathname === `${inbox}/${conversationId}`) {
        router.replace(inbox);
      } else {
        router.refresh();
        // The row this menu sat in is gone; keep focus somewhere sensible.
        document.querySelector<HTMLElement>(`a[href="${inbox}"]`)?.focus();
      }
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
          ...(!archived
            ? [
                {
                  key: "archive",
                  label: t("dm.archive"),
                  icon: <IconInboxOut size={15} />,
                  onSelect: () => move("archive"),
                },
              ]
            : restoreInMenu
              ? [
                  {
                    key: "restore",
                    label: t("dm.restore"),
                    icon: <IconInboxIn size={15} />,
                    onSelect: () => move("restore"),
                  },
                ]
              : []),
          {
            key: "delete",
            label: t("dm.delete"),
            icon: <IconTrash size={15} />,
            danger: true,
            separatorBefore: !archived || restoreInMenu,
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
          {t("dm.delete.title")}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{t("dm.delete.body")}</p>
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
            {t("dm.delete.cancel")}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="h-9 rounded-[5px] bg-rust px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {pending ? t("dm.delete.pending") : t("dm.delete.confirm")}
          </button>
        </div>
      </ConfirmDialog>
    </div>
  );
}

/**
 * Archive or restore one conversation, with a short notice either way. The
 * conversation stays open if it is open; a list it sat in refreshes.
 */
function useMoveConversation(communityId: string, conversationId: string) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (to: "archive" | "restore") => {
    if (pending) return;
    startTransition(async () => {
      const result =
        to === "archive"
          ? await archiveDirectConversationAction(communityId, conversationId)
          : await restoreDirectConversationAction(communityId, conversationId);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      // An archive that lost to a delete changed nothing: no success notice,
      // only a refresh so the page shows where the conversation really is.
      if (result.applied) showToast(t(to === "archive" ? "dm.done.archived" : "dm.done.restored"));
      router.refresh();
    });
  };
}

/** The visible «Gjenopprett» beside an archived conversation. */
export function RestoreConversationButton({
  communityId,
  conversationId,
  otherName,
}: {
  communityId: string;
  conversationId: string;
  otherName: string;
}) {
  const t = useT();
  const move = useMoveConversation(communityId, conversationId);
  return (
    <button
      type="button"
      onClick={() => move("restore")}
      aria-label={`${t("dm.restore")}: ${otherName}`}
      className="h-8 shrink-0 rounded-[5px] border border-line-2 px-2.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
    >
      {t("dm.restoreShort")}
    </button>
  );
}
