/**
 * How long a copy of something deleted from TING can remain in the hosting
 * provider's database backups, in days. Shown wherever a member is told that
 * a direct message is removed: the disappearing-messages dialog and the
 * delete confirmations.
 *
 * Omar confirmed the Pro upgrade and seven-day retention on 2026-10-28.
 * Review this value if the plan, point-in-time recovery or other retained
 * backup copies change, and keep docs/ops/post-restore.md in step.
 */
export const BACKUP_RETENTION_DAYS = 7;
