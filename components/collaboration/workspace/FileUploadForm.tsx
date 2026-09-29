"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { fieldClass, hintClass, labelClass } from "@/components/collaboration/workspace/WorkspaceForm";
import { Button, cn } from "@/components/ui/primitives";
import { COLLABORATION_FILE_MAX_BYTES } from "@/lib/collaboration-file-type";
import { FILE_NAME_MAX } from "@/lib/collaboration-workspace-form";
import { useT } from "@/lib/i18n/react";

/**
 * Upload one file.
 *
 * Posts to the collaboration's own upload route rather than a server action,
 * so the file cap does not widen the request limit of every action in the
 * app. The `accept` list and the size check here only help the person; the
 * route decides the type from the bytes and re-checks the size, and the
 * database and bucket check both again. What they typed stays in place if
 * the upload is refused.
 */
export function FileUploadForm({ slug }: { slug: string }) {
  const t = useT();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<{ ok: boolean; message: string }>();
  const [pending, startTransition] = useTransition();
  const max = COLLABORATION_FILE_MAX_BYTES / (1024 * 1024);

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setState({ ok: false, message: t("ws.files.noFile") });
      return;
    }
    if (file.size > COLLABORATION_FILE_MAX_BYTES) {
      setState({ ok: false, message: t("ws.files.tooLarge", { max }) });
      return;
    }
    startTransition(async () => {
      try {
        const response = await fetch(`/collaboration/${slug}/files/upload`, { method: "POST", body: data });
        const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
        const ok = response.ok && body?.ok === true;
        setState({ ok, message: body?.message ?? t("ws.files.failed") });
        if (ok) {
          formRef.current?.reset();
          router.refresh();
        }
      } catch {
        setState({ ok: false, message: t("ws.files.failed") });
      }
    });
  }

  return (
    <form
      ref={formRef}
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="file-input" className={labelClass}>
            {t("ws.files.choose")}
          </label>
          <input
            id="file-input"
            name="file"
            type="file"
            required
            accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.odt,.ods,.odp,.txt,.csv,.md"
            className="block w-full min-w-0 text-[13px] text-ink-2 file:mr-3 file:h-9 file:rounded-[5px] file:border file:border-line-2 file:bg-surface file:px-3 file:text-[13px] file:font-medium file:text-ink hover:file:bg-paper-2"
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="file-name" className={labelClass}>
            {t("ws.files.name")}
          </label>
          <input id="file-name" name="displayName" maxLength={FILE_NAME_MAX} className={`${fieldClass} h-10`} />
          <p className={hintClass}>{t("ws.files.nameHint")}</p>
        </div>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-3">{t("ws.files.allowed", { max })}</p>
      {state ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={cn(
            "rounded-[5px] border px-3 py-2 text-[13px] leading-relaxed",
            state.ok ? "border-skog/20 bg-skog-soft text-skog" : "border-rust/25 bg-rust-soft text-rust",
          )}
        >
          {state.message}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "…" : t("ws.files.upload")}
      </Button>
    </form>
  );
}
