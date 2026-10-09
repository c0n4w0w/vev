"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/components/ui/primitives";

export type ActionMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Muted destructive styling. */
  danger?: boolean;
  /** Draws a thin divider above this item. */
  separatorBefore?: boolean;
  onSelect: () => void;
};

const itemClass = cn(
  "flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-left text-[13px] outline-none transition-colors",
  "hover:bg-paper-2 focus-visible:bg-paper-2",
);

/**
 * A small button that opens a list of actions, with menu semantics:
 * Enter/Space/ArrowDown open it and focus the first item, arrows and Home/End
 * move between items (wrapping), Escape closes it and returns focus to the
 * button, and Tab or a click outside closes it. Selecting an item closes the
 * menu before running the item.
 *
 * Collapsed by default. What appears in it is presentation only; whoever
 * renders it decides who gets it, and the database decides what each action
 * may do.
 */
export function ActionMenu({
  label,
  trigger,
  ariaLabel,
  triggerClassName,
  items,
  align = "left",
  triggerRef,
}: {
  /** Accessible name of the menu itself. */
  label: string;
  /** The button's contents; receives whether the menu is open. */
  trigger: (open: boolean) => ReactNode;
  /** Accessible name of the button, when its contents are only an icon. */
  ariaLabel?: string;
  triggerClassName: string;
  items: ActionMenuItem[];
  align?: "left" | "right";
  /** Lets the owner return focus to the button, e.g. after a dialog. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ownTriggerRef = useRef<HTMLButtonElement>(null);
  const buttonRef = triggerRef ?? ownTriggerRef;

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    menuItems()[0]?.focus();
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const list = menuItems();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          triggerClassName,
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-3",
        )}
      >
        {trigger(open)}
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute top-full z-20 mt-1.5 w-60 rounded-[6px] border border-line bg-surface p-1 shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <div key={item.key}>
              {item.separatorBefore ? <div role="separator" className="my-1 h-px bg-line" /> : null}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  itemClass,
                  item.danger ? "text-rust/80 hover:text-rust focus-visible:text-rust" : "text-ink",
                )}
              >
                {item.icon ? (
                  <span className={cn("shrink-0", item.danger ? "" : "text-ink-3")}>{item.icon}</span>
                ) : null}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
