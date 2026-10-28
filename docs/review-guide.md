# Review guide

Where an outside reviewer's time is most likely to pay off, in rough order of
impact. None of these is a known vulnerability: they are the areas with the
most rules, the most moving parts, or code paths that bypass row level
security. Test on your own local installation (README → Run a local demo) and
report anything security-relevant privately ([SECURITY.md](../SECURITY.md)).

A useful technique throughout: sign in as one fixture, copy the session's
access token, and call PostgREST or the RPC functions directly with the
publishable key — the database must refuse what the pages merely hide.

## 1. Cross-community isolation and collaborations

- Can a member of one community read or infer anything private about another:
  its existence, members, channels, posts, events, counts, avatars?
- **Collaborations** (`20260928100000_collaborations.sql` and later
  `collaboration_*` migrations, `lib/collaboration-*.ts`) are the only
  intended path between organisations. Each organisation should only ever
  contribute its *own* people; check participant, sponsorship and membership
  transitions, file access (`can_read_collaboration_file_object`), and what
  remains visible after a unit or person leaves.
- Public portals (`portal_by_slug`, `portal_events`) should expose only
  published fields and no member identities.
- Suites: `check:grants`, `check:collaborations`, `check:collaboration-workspace`.

## 2. Private channels and local-group channels

- Visibility of private groups, private local-group channels and their
  messages, reactions, mentions, polls, pins, files and resources to
  non-participants, including admins and moderators where the rules say no.
- Participant changes: adding/removing people, a member moving local group,
  leaving the community, channel deletion — does access end everywhere
  (messages, notifications, attachments, search for mentions)?
- Suites: `check:private-channels`, `check:lokallag-channels`,
  `check:channel-management`, `check:mentions`.

## 3. Roles: admin, moderator, local-group leader, group leader

- Each role's powers are encoded in many `can_*` functions. Look for a power
  that is checked in the page or server action but not in the database, or
  a role change (demotion, removal, admin hand-over) that leaves access behind.
- One active admin per community is enforced by an index; check the hand-over
  and removal paths.
- Suites: `check:role-management`, `check:local-group-leaders`,
  `check:community-groups`, `check:message-moderation`.

## 4. Invitations and membership lifecycle

- Request → approve/reject → invitation → password → active membership
  (`request_community_access`, `approve_access_request`,
  `accept_invitation_token`). Can any step be skipped, replayed, or used for
  a different address or community?
- Invitation and admin-invitation emails carry a sign-in token hash in the
  link's query string (`app/actions.ts`, `lib/platform/invitation-email.ts`,
  `lib/email-sign-in-link.ts`). Review its lifetime, single use and binding to
  the intended account and community.
- Account takeover angles: pre-registering an address, password and email
  change rules (`20261025100000_account_security.sql`).
- Suites: `check:access-requests`, `check:invitation-link`,
  `check:onboarding`, `check:account-security`.

## 5. Direct messages, attachments, expiry and deletion

- Who can start a DM (`can_send_dm`, community DM policy), reply, archive,
  delete.
- Attachment download (`app/(app)/community/[communityId]/attachments/`)
  re-checks access per request; upload is excluded from `proxy.ts` and stores
  objects with the service role after the database opens the upload. Check
  object paths, size/type validation and leftover objects.
- Disappearing messages: access must end exactly at expiry for both sides,
  including notifications, reactions, attachment downloads and cached
  responses. Physical deletion depends on the sweep (see README → Known
  limitations).
- Suites: `check:direct-messages`, `check:dm-inbox`,
  `check:disappearing-messages`, `check:attachments` (see the README for its
  current fresh-stack gap).

## 6. Polls and voter avatars

- Anonymous vs. visible votes: can a voter be identified when the poll says
  they cannot (counts over time, timing, error differences, reactions)?
- `lib/poll-voter-avatar.ts` reads a voter's avatar with the service role
  after `channel_poll_voter_avatar_path()` authorises the viewer. Check that
  function for every visibility case (private channel, removed member, other
  community).
- Suite: `check:polls`.

## 7. Platform administration

- Every `platform_*` function should start with `platform_require()`;
  look for one that does not, or that returns content rather than metadata.
- MFA: AAL2 for everything, recent re-authentication for access changes;
  session revocation; last-owner protection.
- Suspension: does a suspended community become unreachable through every
  path (direct API, notifications, DMs, attachments, collaborations)? See the
  `my_suspended_*` functions.
- Suite: `check:platform-admin` (needs `APP_URL`; writes to the append-only
  audit log, so use a throwaway stack).

## 8. Service-role call sites

The table in [architecture-security.md](architecture-security.md) lists every
place the server uses the service-role key. The comment in
`lib/supabase/admin.ts` lists five of them; the platform logo upload,
`/samarbeid` and the platform invitation email are not in that comment.
Each should act only after the database has authorised the specific action,
and only on the object that authorisation returned.

## 9. Web-layer observations worth a look

- No Content-Security-Policy, and framing protection (`X-Frame-Options`) only
  on `/platform-admin` (`next.config.ts`).
- After requesting a sign-in link, the address is placed in the URL
  (`/login?sendt=<address>`), so it can end up in browser history and logs.
- The public `/samarbeid` form writes through a service-only function; check
  its abuse limits.
- `/demo/<token>` must answer 404 whenever `TING_MODE` is not `demo`.
