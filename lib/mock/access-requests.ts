/**
 * Pending access requests, so an administrator has something in the queue on a
 * fresh install.
 *
 * These are questions from email addresses, not membership rows. Nobody here
 * is a member of anything until an admin approves the request and the invited
 * mailbox redeems the invitation that follows.
 */
export interface SeedAccessRequest {
  communityId: string;
  email: string;
  displayName?: string;
  /** Days before "now" that the request came in. */
  daysAgo: number;
}

export const accessRequests: SeedAccessRequest[] = [
  {
    communityId: "tryggere-ruspolitikk",
    email: "oskar@lie.studio",
    displayName: "Oskar Lie",
    daysAgo: 4,
  },
  {
    communityId: "tryggere-ruspolitikk",
    email: "turid.moen@example.no",
    displayName: "Turid Moen",
    daysAgo: 1,
  },
];
