"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { deletePostAction, setPostPinnedAction, updatePostAction } from "@/app/actions";
import { IconClose } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/react";
import { emptyPostFormState } from "@/lib/post-form";
import type { Post } from "@/lib/types";

function SubmitButton({
  label,
  pendingLabel,
  className,
  style,
  disabled,
}: {
  label: string;
  pendingLabel: string;
  className?: string;
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

/**
 * Edit, pin and delete controls.
 *
 * `canEdit`, `canPin` and `canDelete` decide only whether the controls are
 * *drawn* — the rules that matter are the `posts_update` and `posts_delete`
 * policies and the `set_post_pinned` function, which run whether or not this
 * component renders anything. A viewer who forged their way to submitting any
 * of these forms gets the same refusal from the database.
 */
export function PostActions({
  post,
  canEdit,
  canDelete,
  canPin,
  accent,
}: {
  post: Post;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  accent: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editState, editAction] = useActionState(updatePostAction, emptyPostFormState);
  const [deleteState, deleteAction] = useActionState(deletePostAction, emptyPostFormState);
  const [pinState, pinAction] = useActionState(setPostPinnedAction, emptyPostFormState);

  // Close the editor only once the update is confirmed, adjusted during render
  // rather than in an effect.
  const [handled, setHandled] = useState(editState);
  if (editState !== handled) {
    setHandled(editState);
    if (editState.status === "ok") setEditing(false);
  }

  if (!canEdit && !canDelete && !canPin) return null;

  if (editing) {
    return (
      <form action={editAction} className="mt-3">
        <input type="hidden" name="postId" value={post.id} />
        <input type="hidden" name="communityId" value={post.communityId} />
        {post.title !== undefined ? (
          <input
            name="title"
            defaultValue={post.title}
            placeholder={t("post.titlePlaceholder")}
            className="mb-2 w-full rounded-[5px] border border-line-2 bg-surface px-3 py-2 font-display text-lg text-ink outline-none focus:border-ink-3"
          />
        ) : null}
        <textarea
          name="body"
          defaultValue={post.body}
          rows={5}
          className="w-full resize-none rounded-[5px] border border-line-2 bg-surface px-3 py-2 text-[0.9375rem] leading-[1.7] text-ink outline-none focus:border-ink-3"
        />
        {editState.status === "error" ? (
          <p role="alert" className="mt-2 text-[13px] text-rust">
            {editState.message}
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <SubmitButton
            label={t("common.save")}
            pendingLabel={t("common.saving")}
            className="h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: accent }}
          />
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="h-9 rounded-[5px] px-3 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            {t("common.cancel")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
      {canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-ink-3 transition-colors hover:text-ink"
        >
          {t("common.edit")}
        </button>
      ) : null}

      {canPin ? (
        <form action={pinAction} className="flex items-center">
          <input type="hidden" name="postId" value={post.id} />
          <input type="hidden" name="communityId" value={post.communityId} />
          {/* The wanted state, not a toggle — see setPostPinnedAction. The
              submit button stays unnamed so it cannot collide with this. */}
          <input type="hidden" name="pinned" value={post.pinned ? "0" : "1"} />
          <SubmitButton
            label={post.pinned ? t("post.unpin") : t("post.pin")}
            pendingLabel={post.pinned ? t("post.unpinning") : t("post.pinning")}
            className="text-xs text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
          />
        </form>
      ) : null}

      {canDelete ? (
        confirming ? (
          <form action={deleteAction} className="flex items-center gap-2">
            <input type="hidden" name="postId" value={post.id} />
            <input type="hidden" name="communityId" value={post.communityId} />
            <span className="text-xs text-ink-2">{t("post.confirmDelete")}</span>
            <SubmitButton
              label={t("post.confirmYes")}
              pendingLabel={t("post.deleting")}
              className="text-xs font-medium text-rust transition-opacity hover:opacity-70 disabled:opacity-40"
            />
            <button
              type="button"
              onClick={() => setConfirming(false)}
              aria-label={t("post.cancelDelete")}
              className="text-ink-3 transition-colors hover:text-ink"
            >
              <IconClose size={13} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-xs text-ink-3 transition-colors hover:text-rust"
          >
            {t("common.delete")}
          </button>
        )
      ) : null}

      {deleteState.status === "error" ? (
        <span role="alert" className="text-xs text-rust">
          {deleteState.message}
        </span>
      ) : null}

      {pinState.status === "error" ? (
        <span role="alert" className="text-xs text-rust">
          {pinState.message}
        </span>
      ) : null}
    </div>
  );
}
