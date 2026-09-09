-- Removes the first-generation access path.
--
-- The prototype let an already-registered user ask to join by writing a
-- memberships row with status 'requested', and let an admin flip that row
-- straight to 'active'. Phase 3 replaced both halves: a request is now a
-- question from an email address that may have no account at all, and approval
-- issues an invitation that only becomes a membership when the invited mailbox
-- redeems it.
--
-- Leaving the old functions in place would mean two ways to become a member,
-- one of which skips the invitation entirely — and the weaker one would still
-- be reachable over PostgREST by anyone with a session, whatever the UI shows.
-- So they go.
--
-- The membership RLS model is untouched: `memberships` still has no INSERT,
-- UPDATE or DELETE policy, and the only remaining way to gain one is
-- accept_invitation_token().

drop function if exists public.request_access(text);
drop function if exists public.approve_membership(text, uuid);
drop function if exists public.reject_membership(text, uuid);
drop function if exists public.accept_invitation(text);
drop function if exists public.decline_invitation(text);

-- Only ever called by approve_membership, to clear the notification that an
-- invitation had been issued. Nothing reaches it now.
drop function if exists public.resolve_invitation_notice(uuid, text);

-- The 'invited' and 'requested' membership statuses are left in the enum
-- rather than dropped. Nothing writes them any more — the new lifecycle only
-- ever creates 'active' rows — but removing a value from an enum in
-- PostgreSQL means rebuilding the type and every column that uses it, which is
-- a large and risky change to make for tidiness alone. The states are now
-- simply unreachable.
