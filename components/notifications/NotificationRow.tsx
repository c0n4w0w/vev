"use client";

import Link from "next/link";
import { useTransition } from "react";
import { markNotificationReadAction } from "@/app/actions";

/**
 * One row in the notification list, and the click that marks it read.
 *
 * The row is a single link wrapping the whole card, which is what it already
 * was. Keeping it that way is the accessibility decision: one focus stop per
 * notification, Enter and Space behave as they do on any link, and there is no
 * button nested inside a link for a screen reader to announce twice or for a
 * keyboard user to have to skip past.
 *
 * Marking read therefore rides on the same activation rather than adding a
 * control of its own. Navigation is not prevented and not awaited — the link
 * does what a link does, and the write happens alongside it. Client-side
 * navigation keeps this document alive, so the action completes even though
 * the page has moved on; and if it somehow does not, the cost is a
 * notification that stays bold, which the user can clear with "Merk alle som
 * lest".
 *
 * A row that is already read fires nothing. That keeps a reread from writing,
 * and makes repeating the click trivially idempotent.
 *
 * Without JavaScript the link still navigates and the read state simply does
 * not move — the notification is never a dead end.
 */
export function NotificationRow({
  id,
  href,
  read,
  className,
  children,
}: {
  id: string;
  /** Null when the stored href is not an internal path — see lib/notification-href. */
  href: string | null;
  read: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [, startTransition] = useTransition();

  function markRead() {
    if (read) return;
    startTransition(() => {
      void markNotificationReadAction(id);
    });
  }

  // Nothing safe to link to: render the same card, without a link. The
  // notification is still readable, which is the point of it.
  if (!href) {
    return <div className={className}>{children}</div>;
  }

  return (
    <Link href={href} className={className} onClick={markRead}>
      {children}
    </Link>
  );
}
