"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createDocumentAction, saveDocumentAction } from "@/app/collaboration-workspace-actions";
import {
  WorkspaceForm,
  fieldClass,
  labelClass,
} from "@/components/collaboration/workspace/WorkspaceForm";
import { Button, cn } from "@/components/ui/primitives";
import {
  DOCUMENT_CONTENT_MAX,
  DOCUMENT_TITLE_MAX,
  emptyDocumentSaveState,
} from "@/lib/collaboration-workspace-form";
import { useLocale, useT } from "@/lib/i18n/react";
import type { WorkspaceDocument } from "@/lib/types";

export function CreateDocumentForm({ collaborationId, slug }: { collaborationId: string; slug: string }) {
  const t = useT();
  return (
    <WorkspaceForm
      action={createDocumentAction}
      hidden={{ collaborationId, slug }}
      submitLabel={t("ws.docs.create")}
    >
      <div>
        <label htmlFor="doc-title" className={labelClass}>
          {t("ws.docs.titleLabel")}
        </label>
        <input
          id="doc-title"
          name="title"
          required
          maxLength={DOCUMENT_TITLE_MAX}
          placeholder={t("ws.docs.titlePlaceholder")}
          className={`${fieldClass} h-10`}
        />
      </div>
    </WorkspaceForm>
  );
}

/**
 * Plain-text editing with an honest save.
 *
 * Each save names the revision the text was based on. If someone else saved
 * in between, the database refuses with a conflict and nothing is written —
 * the text stays here, and the person decides what to do with it. There is
 * no autosave and no merge: overwriting a colleague silently is the one thing
 * this must not do. Every saved state is kept as a version.
 */
export function DocumentEditor({
  document,
  collaborationId,
  slug,
}: {
  document: WorkspaceDocument;
  collaborationId: string;
  slug: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState(saveDocumentAction, emptyDocumentSaveState);
  const [saving, startTransition] = useTransition();
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content);
  const [base, setBase] = useState({ revision: document.revision, title: document.title, content: document.content });
  const handled = useRef(state);
  const formRef = useRef<HTMLFormElement>(null);

  const dirty = title !== base.title || content !== base.content;

  // A successful save moves the base forward to exactly what was sent.
  const sent = useRef({ title, content });
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state.status === "saved" || state.status === "unchanged") {
      setBase({ revision: state.revision, title: sent.current.title, content: sent.current.content });
    }
  }, [state]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function submit() {
    if (!formRef.current || saving) return;
    sent.current = { title, content };
    const formData = new FormData(formRef.current);
    startTransition(() => formAction(formData));
  }

  const message = state.status === "idle" ? undefined : state.message;
  const tone = state.status === "conflict" || state.status === "error" ? "error" : "ok";

  return (
    <form
      ref={formRef}
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          submit();
        }
      }}
    >
      <input type="hidden" name="documentId" value={document.id} />
      <input type="hidden" name="collaborationId" value={collaborationId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="revision" value={base.revision} />

      <div>
        <label htmlFor="doc-edit-title" className="sr-only">
          {t("ws.docs.titleLabel")}
        </label>
        <input
          id="doc-edit-title"
          name="title"
          required
          maxLength={DOCUMENT_TITLE_MAX}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full min-w-0 border-0 border-b border-transparent bg-transparent px-0 py-1 font-display text-[1.625rem] leading-tight text-ink outline-none focus:border-line-2"
        />
      </div>

      <div>
        <label htmlFor="doc-edit-content" className="sr-only">
          {t("ws.docs.content")}
        </label>
        <textarea
          id="doc-edit-content"
          name="content"
          value={content}
          maxLength={DOCUMENT_CONTENT_MAX}
          onChange={(event) => setContent(event.target.value)}
          rows={20}
          spellCheck
          className={cn(
            fieldClass,
            "min-h-[50vh] resize-y py-3 font-mono text-[13.5px] leading-[1.7] sm:text-[14px]",
          )}
        />
      </div>

      {message ? (
        <div
          role={tone === "error" ? "alert" : "status"}
          className={cn(
            "rounded-[5px] border px-3 py-2 text-[13px] leading-relaxed",
            tone === "error" ? "border-rust/25 bg-rust-soft text-rust" : "border-skog/20 bg-skog-soft text-skog",
          )}
        >
          <p>{message}</p>
          {state.status === "conflict" ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 font-medium underline underline-offset-2"
            >
              {t("ws.docs.reload")}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="sticky bottom-[4.75rem] z-10 -mx-1 flex flex-wrap items-center gap-3 bg-paper/95 px-1 py-2 backdrop-blur-sm lg:bottom-0">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? t("ws.docs.saving") : t("ws.docs.save")}
        </Button>
        {dirty ? <span className="text-[12.5px] font-medium text-rust">{t("ws.docs.unsaved")}</span> : null}
        <span className="text-[12px] text-ink-3">{t("ws.docs.version", { revision: base.revision })}</span>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">{t("ws.docs.noAutosave")}</p>
    </form>
  );
}

/** Saving an earlier version's text as the next revision. Nothing is deleted. */
export function RestoreVersionForm({
  documentId,
  collaborationId,
  slug,
  currentRevision,
  version,
}: {
  documentId: string;
  collaborationId: string;
  slug: string;
  currentRevision: number;
  version: { revision: number; title: string; content: string };
}) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState(saveDocumentAction, emptyDocumentSaveState);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="collaborationId" value={collaborationId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="revision" value={currentRevision} />
      <input type="hidden" name="restoredFrom" value={version.revision} />
      <input type="hidden" name="title" value={version.title} />
      <input type="hidden" name="content" value={version.content} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending || state.status === "saved"}>
          {pending ? "…" : t("ws.docs.restore")}
        </Button>
        <span className="text-[12.5px] text-ink-3">{t("ws.docs.restoreNote")}</span>
      </div>
      {state.status !== "idle" ? (
        <p
          role={state.status === "saved" ? "status" : "alert"}
          className={cn("text-[13px]", state.status === "saved" ? "text-skog" : "text-rust")}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
