-- Tidies up a stray grant.
--
-- The blanket `revoke execute on all functions in schema public from anon,
-- authenticated` in 20260906120100_rpc.sql runs before handle_new_user() is
-- created further down the same file, so that function kept PostgreSQL's
-- default PUBLIC execute grant.
--
-- It is not exploitable — it returns `trigger`, so a direct call fails with
-- "trigger functions can only be called as triggers", and PostgREST does not
-- expose trigger-returning functions over the API. This is housekeeping so
-- that the list of functions anon may execute contains only the three portal
-- entry points, and an audit of that list stays meaningful.

revoke execute on function public.handle_new_user() from public, anon, authenticated;
