"use client";

import { useActionState, useEffect, useRef, useTransition, type ReactNode } from "react";
import { Button, cn } from "@/components/ui/primitives";
import { emptyWorkspaceFormState, type WorkspaceFormState } from "@/lib/collaboration-workspace-form";
import { useLocale } from "@/lib/i18n/react";

type Action = (prev: WorkspaceFormState, formData: FormData) => Promise<WorkspaceFormState>;

export const fieldClass =
  "w-full min-w-0 rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3 focus-visible:ring-2 focus-visible:ring-skog/20 disabled:bg-paper-2 disabled:text-ink-3";

export const labelClass = "mb-1.5 block text-sm font-medium text-ink";
export const hintClass = "mt-1.5 text-[12.5px] leading-relaxed text-ink-3";

/**
 * One workspace form.
 *
 * Submits through `onSubmit` rather than the `action` prop so that a refused
 * write — the database said no, or the person lost access a moment ago —
 * leaves everything they typed in place. Fields are reset only after a
 * successful write, and only if `resetOnSuccess`.
 *
 * `hidden` carries ids; `locale` is added so the reply is in the screen's
 * language. None of them grant anything: the database decides.
 */
export function WorkspaceForm({
  action,
  hidden,
  children,
  submitLabel,
  submitVariant = "primary",
  resetOnSuccess = false,
  className,
  footer,
  onSuccess,
}: {
  action: Action;
  hidden: Record<string, string>;
  children: ReactNode;
  submitLabel: string;
  submitVariant?: "primary" | "secondary";
  resetOnSuccess?: boolean;
  className?: string;
  /** Rendered beside the submit button. */
  footer?: ReactNode;
  onSuccess?: (state: WorkspaceFormState) => void;
}) {
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(action, emptyWorkspaceFormState);
  const [pending, startTransition] = useTransition();
  const handled = useRef<WorkspaceFormState>(state);

  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state.status !== "ok") return;
    if (resetOnSuccess) formRef.current?.reset();
    onSuccess?.(state);
  }, [state, resetOnSuccess, onSuccess]);

  return (
    <form
      ref={formRef}
      className={cn("space-y-4", className)}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="locale" value={locale} />
      {children}
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={cn(
            "rounded-[5px] border px-3 py-2 text-[13px] leading-relaxed",
            state.status === "error"
              ? "border-rust/25 bg-rust-soft text-rust"
              : "border-skog/20 bg-skog-soft text-skog",
          )}
        >
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={submitVariant} size="sm" disabled={pending}>
          {pending ? "…" : submitLabel}
        </Button>
        {footer}
      </div>
    </form>
  );
}
