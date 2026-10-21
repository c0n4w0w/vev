"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A native modal dialog: focus moves into it, Escape and the backdrop close
 * it, and the rest of the page is inert while it is open. Opening and closing
 * are driven by `open`; `onClose` fires however it was dismissed.
 */
export function ConfirmDialog({
  open,
  onClose,
  labelledBy,
  className = "",
  trapFocus = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className?: string;
  trapFocus?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onKeyDown={(event) => {
        if (!trapFocus || event.key !== "Tab") return;
        const dialog = event.currentTarget;
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
          "button, a[href], input, select, textarea, [tabindex]",
        )).filter((element) =>
          element.tabIndex >= 0 &&
          !element.matches(":disabled, [hidden]") &&
          element.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] max-w-md rounded-[8px] border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/30 ${className}`}
    >
      <div className="p-5">{children}</div>
    </dialog>
  );
}
