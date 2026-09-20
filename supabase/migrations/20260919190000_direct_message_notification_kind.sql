-- Notification kind used by the direct-message trigger.
--
-- Kept in its own migration so the enum value is committed before later
-- functions use it in INSERT statements.
alter type notification_kind add value if not exists 'direct_message';
