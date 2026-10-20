/**
 * How long a copy of something deleted from TING can remain in the hosting
 * provider's database backups, in days. Shown wherever a member is told that
 * a direct message is removed: the disappearing-messages dialog and the
 * delete confirmations.
 *
 * PLACEHOLDER — NOT CONFIRMED. "N" is shown as-is until the Supabase plan's
 * retention is confirmed: the longest of the daily backups (Pro: 7 days) and
 * point-in-time recovery, if that add-on is on (7, 14 or 28 days). Replace it
 * with that number before disappearing messages are deployed, and keep
 * docs/ops/post-restore.md in step.
 */
export const BACKUP_RETENTION_DAYS: number | "N" = "N";
