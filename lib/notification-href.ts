/**
 * Whether a notification's link may be followed as a link.
 *
 * `notifications.href` is free text. Every value in it today is written by the
 * seed or by `accept_invitation_token()`, both trusted, and since
 * 20260916160000 a recipient cannot rewrite the column at all — so nothing can
 * currently put a hostile value there.
 *
 * The guard is for what comes next. Notification generation is the following
 * piece of work, and a generator that interpolates a slug or a title into a
 * path is one mistake away from emitting `//evil.example` or a `javascript:`
 * URL. This page is a trusted surface: a row here looks like the application
 * telling you something, and a link that quietly leaves the site from such a
 * row is worth more to an attacker than the same link anywhere else.
 *
 * So the rule is the narrowest one that keeps every real value working: an
 * internal absolute path, and nothing else. A value that fails it still
 * renders — the notification is not hidden, and its title and body are still
 * read — it simply is not a link.
 *
 * Rejected, deliberately:
 *   //host/path     protocol-relative; browsers treat this as another origin
 *   /\host/path     some browsers normalise the backslash and do the same
 *   https://…       another origin, stated outright
 *   javascript:…    script execution
 *   anything not starting with "/", including a bare relative path, which
 *   would resolve against whatever page happened to render it
 */
export function internalHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;
  if (trimmed.startsWith("/\\")) return null;
  return trimmed;
}
