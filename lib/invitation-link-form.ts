/** What the one-email sign-in buttons report back to their page. */
export type InvitationLinkState =
  | { status: "idle" }
  /** Signed in as a different account; the page offers an explicit switch. */
  | { status: "mismatch" }
  /** The sign-in part of the link is spent or expired; the page offers a fresh one. */
  | { status: "link-expired" }
  | { status: "error"; message: string };

export const emptyInvitationLinkState: InvitationLinkState = { status: "idle" };
