# Architecture and security overview

A short map for reviewers. It describes what the code does today; where
something is untested or unresolved, it says so. The Norwegian operator guide
([drift-og-oppsett.md](drift-og-oppsett.md)) has the full detail.

## Components

```
Browser ──► Next.js (App Router, server components + server actions)
              │  proxy.ts refreshes the Supabase session cookie on each request
              │
              ├─ member's session client (publishable key + user JWT)
              │     └─► PostgREST ──► Postgres: RLS policies + SECURITY DEFINER functions
              │
              └─ service-role client (server only, a few named call sites)
                    └─► Auth admin / Storage / a few service-only functions
Supabase Auth (email + password, email links, TOTP MFA)
Supabase Storage (private buckets: message attachments, avatars, collaboration files)
```

There is no separate API server. Pages and server actions query Supabase
**as the signed-in member**, so the database decides what each person can
read or change. `lib/data.ts` is the main data layer.

## Authentication

- **Supabase Auth** stores and checks passwords. Sign-in is by email and
  password, or a one-time email link. There is no third-party sign-in.
- **Rules enforced in the database**
  (`supabase/migrations/20261025100000_account_security.sql`):
  - No account is created with a password, and a password present when the
    address is first confirmed is discarded, so nobody can pre-register on
    someone else's address.
  - A membership does not become active until the account has a password.
  - An existing password can only be changed by a session that has just
    proved the current password, or that came from a recovery email.
  - Changing email address requires a recent password proof, and confirmation
    from the new address while signed in.
  - Password attempts are counted per account (exponential back-off) and per
    network address, before Supabase is asked.
- **Network address.** Read only from the part of `X-Forwarded-For` written by
  the operator's own proxies (`TRUSTED_PROXY_COUNT`, `lib/client-ip.ts`).
  Unset means no address is trusted.
- **IP forwarding to Supabase Auth** (`lib/supabase/auth-forwarding.ts`): with
  `SUPABASE_SECRET_KEY` set, the secret key and the member's address are sent
  only to Auth's rate-limited endpoints. Whether hosted Supabase honours it
  has **not** been verified.
- **Showcase entry** (`/demo/<token>`, `lib/demo/entry.ts`) mints a session for
  a fixture persona. It answers 404 unless `TING_MODE=demo`, and compares
  tokens in constant time.
- **Platform administration** requires TOTP (AAL2) for everything, and a fresh
  second factor (≤ 10 minutes) for changes to who has platform access.

## Community isolation

- **No directory.** `communities` is readable only by people with a
  `memberships` row in that community (and, as names/counts only, by platform
  operators behind MFA). Public portals go through `portal_by_slug()` and
  `portal_events()`, which take one exact slug and return only published
  fields.
- **Every content table** (channels, messages, posts, comments, events,
  polls, notifications, attachments, …) has RLS enabled, with policies built
  from helper predicates such as `is_member()`, `is_admin()`,
  `can_read_channel()`, `can_read_post_scope()`, `can_read_direct_message()`
  and `can_view_member_directory()`.
- **Explicit grants.** New `public` tables are not exposed to the API roles
  automatically (`auto_expose_new_tables = false`, matching hosted Supabase).
  `20261026100000_explicit_api_grants.sql` grants each role exactly what it
  needs: `anon` no tables and a handful of functions; `authenticated` only
  operations that have a policy; `service_role` read/write but never
  `truncate`. `npm run check:grants` compares the catalogue with this matrix.
- **Membership changes only through functions.** `memberships` has no insert,
  update or delete policy; transitions go through
  `request_community_access`, `approve_access_request`,
  `reject_access_request`, `accept_invitation_token` and the role-management
  functions, each of which checks its own preconditions.
- **Inside a community:** private channels and local-group channels limit
  reading to participants or local-group members; admins, moderators,
  local-group leaders and group leaders have distinct powers.
- **Deliberate cross-community features:** *collaborations* (a private
  workspace several organisations join, where each organisation chooses which
  of its own people take part — `20260928100000_collaborations.sql` and
  follow-ups). It is the only intended path by which people in one community
  see anything private of another, and is worth reviewing as such. («Related
  communities» on the overview page are hand-written links to another
  community's public portal, defined in `lib/related-communities.ts`; they
  read no data.)
- **Non-members** who open `/community/<id>` are redirected to the public
  portal (or get 404), so the private space is not confirmed to exist.

## Privileged server operations

The service-role key bypasses RLS. It is used only on the server, never sent
to a browser (`TING_MODE`, `SUPABASE_*` keys have no `NEXT_PUBLIC_` prefix),
and only at these call sites:

| Call site | Why |
| --- | --- |
| `lib/email-sign-in-link.ts` via `app/actions.ts`, `lib/platform/invitation-email.ts` | Mint the sign-in token in an approval or admin-invitation email, after the database has authorised the action |
| `lib/demo/entry.ts` | Showcase entry (demo deployments only) |
| `lib/attachment-storage.ts` | Write/remove attachment objects; browsers have no write access to that bucket |
| `lib/account-security.ts` | Count password attempts (functions callable by the service role only) |
| `lib/poll-voter-avatar.ts` | Read one voter's avatar object after `channel_poll_voter_avatar_path()` has authorised it for the signed-in viewer |
| `app/platform-admin/actions.ts` | Store/remove a community logo after the operator check |
| `app/samarbeid/actions.ts` | Submit the public "join TING" request through a service-only function |
| `scripts/*` | Seed, bootstrap, platform owner, sweeps and checks — command line only |

Anyone holding the service-role key, the newer secret key or the database
password can read and change everything.

## Platform-admin boundary

Platform roles (`owner`, `operator`) live in `platform_operators`, separate
from community roles. Platform tables have no API grants; every action goes
through `SECURITY DEFINER` functions that start with `platform_require()`,
which checks the verified JWT: active operator, live session, AAL2, owner role
where needed, and recent re-authentication for access changes. Operators see
metadata and aggregates — names, status, settings, the administrator's
contact, member counts — never messages, DMs, posts, channels or member
lists, and they never become members. Suspension, community creation and
operator changes are written to an append-only audit log. Pages under
`/platform-admin` return the site's normal 404 to everyone else.

This boundary is enforced in the application and database functions; it is
not a boundary against whoever operates the database (see above).

## Attachments and disappearing messages

- Attachments live in the private `message-attachments` bucket and are served
  only through `/community/<id>/attachments/<id>`, which re-checks access on
  every request. There are no public or signed URLs. DM attachments are sent
  with `Cache-Control: private, no-store`.
- Deleting something queues its objects in `message_attachment_purges`; a row
  leaves the queue only after Storage confirms the delete.
- Disappearing DMs: **access** ends at expiry (enforced in RLS); **physical
  deletion** happens in `purge_expired_direct_messages()` (run by
  `npm run attachments:sweep`, intended every five minutes) and when the
  conversation is opened; **backups** may keep content until they expire, and
  a restore requires `docs/ops/post-restore.md`. Retention of hosted backups is
  unverified.

## Not in place (yet)

- End-to-end encryption.
- A general Content-Security-Policy or framing protection outside
  `/platform-admin` (only that path sets `X-Frame-Options` and a strict
  referrer policy in `next.config.ts`).
- An external security audit.
