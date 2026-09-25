"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createCommentAction,
  deleteCommentAction,
  updateCommentAction,
} from "@/app/actions";
import { emptyCommentFormState } from "@/lib/comment-form";
import { Avatar, cn } from "@/components/ui/primitives";
import { timeAgo } from "@/lib/format";
import type { Comment, CommunityPersona } from "@/lib/types";

function Submit({
  label,
  pendingLabel,
  className,
  style,
  disabled,
}: {
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

function CommentComposer({
  postId,
  communityId,
  parentId,
  author,
  accent,
  placeholder,
  onDone,
  autoFocus,
}: {
  postId: string;
  communityId: string;
  parentId?: string;
  author: CommunityPersona;
  accent: string;
  placeholder: string;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const [state, formAction] = useActionState(createCommentAction, emptyCommentFormState);
  const [draft, setDraft] = useState("");

  // Clear only once the write is confirmed, adjusted during render.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "ok") {
      setDraft("");
      onDone?.();
    }
  }

  return (
    <form action={formAction} className="flex items-start gap-2.5">
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="communityId" value={communityId} />
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}
      <Avatar user={author} size="xs" className="mt-1" />
      <div className="min-w-0 flex-1">
        <textarea
          name="body"
          rows={2}
          value={draft}
          autoFocus={autoFocus}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          className="w-full resize-none rounded-[5px] border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink-3"
        />
        {state.status === "error" ? (
          <p role="alert" className="mt-1.5 text-[12px] text-rust">
            {state.message}
          </p>
        ) : null}
        <div className="mt-1.5 flex items-center gap-2">
          <Submit
            label="Kommenter"
            pendingLabel="Lagrer …"
            disabled={!draft.trim()}
            className="h-8 rounded-[5px] px-3 text-[13px] font-medium text-white transition-opacity disabled:opacity-30"
            style={{ backgroundColor: accent }}
          />
          {onDone ? (
            <button
              type="button"
              onClick={onDone}
              className="h-8 rounded-[5px] px-2 text-[13px] text-ink-3 transition-colors hover:text-ink"
            >
              Avbryt
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function CommentRow({
  comment,
  author,
  communityId,
  viewerId,
  canModerate,
  accent,
  onReply,
  isReply,
}: {
  comment: Comment;
  author?: CommunityPersona;
  communityId: string;
  viewerId: string;
  canModerate: boolean;
  accent: string;
  onReply?: () => void;
  isReply?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editState, editAction] = useActionState(updateCommentAction, emptyCommentFormState);
  const [deleteState, deleteAction] = useActionState(deleteCommentAction, emptyCommentFormState);

  const [handled, setHandled] = useState(editState);
  if (editState !== handled) {
    setHandled(editState);
    if (editState.status === "ok") setEditing(false);
  }

  const isAuthor = comment.authorId === viewerId;

  return (
    <li className={cn("flex items-start gap-2.5", isReply && "ml-7 sm:ml-9")}>
      {author ? <Avatar user={author} size="xs" className="mt-0.5" /> : null}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-medium text-ink">{author?.name ?? "Ukjent"}</span>
          <span className="text-[11px] text-ink-3">{timeAgo(comment.createdAt)}</span>
          {comment.editedAt ? <span className="text-[11px] text-ink-3">· endret</span> : null}
        </p>

        {editing ? (
          <form action={editAction} className="mt-1">
            <input type="hidden" name="commentId" value={comment.id} />
            <input type="hidden" name="communityId" value={communityId} />
            <textarea
              name="body"
              defaultValue={comment.body}
              rows={3}
              className="w-full resize-none rounded-[5px] border border-line-2 bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-ink-3"
            />
            {editState.status === "error" ? (
              <p role="alert" className="mt-1 text-[12px] text-rust">
                {editState.message}
              </p>
            ) : null}
            <div className="mt-1.5 flex items-center gap-2">
              <Submit
                label="Lagre"
                pendingLabel="Lagrer …"
                className="h-8 rounded-[5px] px-3 text-[13px] font-medium text-white"
                style={{ backgroundColor: accent }}
              />
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-8 px-2 text-[13px] text-ink-3 transition-colors hover:text-ink"
              >
                Avbryt
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-ink-2">
            {comment.body}
          </p>
        )}

        {!editing ? (
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {onReply ? (
              <button
                type="button"
                onClick={onReply}
                className="text-[11px] text-ink-3 transition-colors hover:text-ink"
              >
                Svar
              </button>
            ) : null}
            {isAuthor ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[11px] text-ink-3 transition-colors hover:text-ink"
              >
                Endre
              </button>
            ) : null}
            {isAuthor || canModerate ? (
              confirming ? (
                <form action={deleteAction} className="flex items-center gap-2">
                  <input type="hidden" name="commentId" value={comment.id} />
                  <input type="hidden" name="communityId" value={communityId} />
                  <span className="text-[11px] text-ink-2">Slette?</span>
                  <Submit
                    label="Ja"
                    pendingLabel="…"
                    className="text-[11px] font-medium text-rust transition-opacity hover:opacity-70"
                  />
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="text-[11px] text-ink-3 transition-colors hover:text-ink"
                  >
                    Nei
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="text-[11px] text-ink-3 transition-colors hover:text-rust"
                >
                  Slett
                </button>
              )
            ) : null}
            {deleteState.status === "error" ? (
              <span role="alert" className="text-[11px] text-rust">
                {deleteState.message}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Comments on a post, with one level of replies — the depth the database
 * allows, and as much as the conversation here needs.
 *
 * The thread is collapsed until asked for, so a feed of long discussions stays
 * readable. Counts come from the post's derived `comment_count`.
 */
export function CommentThread({
  postId,
  communityId,
  commentCount,
  comments,
  authors,
  viewer,
  canModerate,
  accent,
}: {
  postId: string;
  communityId: string;
  commentCount: number;
  comments: Comment[];
  authors: Record<string, CommunityPersona>;
  viewer: CommunityPersona;
  canModerate: boolean;
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  const topLevel = comments.filter((comment) => !comment.parentId);
  const repliesOf = (id: string) => comments.filter((comment) => comment.parentId === id);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-xs text-ink-3 transition-colors hover:text-ink"
      >
        {commentCount === 0
          ? "Skriv den første kommentaren"
          : `${commentCount} ${commentCount === 1 ? "kommentar" : "kommentarer"}`}
      </button>

      {open ? (
        <div className="mt-3 space-y-4">
          {topLevel.length > 0 ? (
            <ul className="space-y-4">
              {topLevel.map((comment) => (
                <li key={comment.id} className="list-none">
                  <ul className="space-y-3">
                    <CommentRow
                      comment={comment}
                      author={authors[comment.authorId]}
                      communityId={communityId}
                      viewerId={viewer.id}
                      canModerate={canModerate}
                      accent={accent}
                      onReply={() =>
                        setReplyingTo((current) => (current === comment.id ? null : comment.id))
                      }
                    />
                    {repliesOf(comment.id).map((reply) => (
                      <CommentRow
                        key={reply.id}
                        comment={reply}
                        author={authors[reply.authorId]}
                        communityId={communityId}
                        viewerId={viewer.id}
                        canModerate={canModerate}
                        accent={accent}
                        isReply
                      />
                    ))}
                  </ul>

                  {replyingTo === comment.id ? (
                    <div className="ml-7 mt-3 sm:ml-9">
                      <CommentComposer
                        postId={postId}
                        communityId={communityId}
                        parentId={comment.id}
                        author={viewer}
                        accent={accent}
                        placeholder={`Svar ${authors[comment.authorId]?.name.split(" ")[0] ?? ""}`}
                        onDone={() => setReplyingTo(null)}
                        autoFocus
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <CommentComposer
            postId={postId}
            communityId={communityId}
            author={viewer}
            accent={accent}
            placeholder="Skriv en kommentar"
          />
        </div>
      ) : null}
    </div>
  );
}
