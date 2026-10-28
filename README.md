# TING

A platform for private communities: **one account, many organisations**.

Associations, collectives and volunteer organisations each get a closed space
with members, channels, a feed, events, announcements, direct messages, polls
and local groups. The platform provides the infrastructure; each organisation
keeps its own identity. A person holds one account and can have a different
role in every community they belong to, and no community can see another's
members or content.

> **Status: pre-pilot.** TING has not run with real communities yet, has not
> had an external security audit, and is not production-ready. Messages are
> not end-to-end encrypted. See [Known limitations](#known-limitations) before
> drawing conclusions from the code.

- **Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4,
  Supabase (Postgres with row level security, Auth, Storage).
- **Interface languages:** Norwegian Bokmål and English. Many code comments and
  the operator guide are in Norwegian.
- **Where the rules live:** in the database. Access is decided by row level
  security and `SECURITY DEFINER` functions in `supabase/migrations/`, not by
  the pages. See [Architecture and security](docs/architecture-security.md).

## Run a local demo

Everything runs on your machine: a local Supabase stack in Docker, synthetic
fixtures, and Mailpit for email. No hosted credentials, no real users and no
access to anyone's infrastructure are needed.

### Prerequisites

- **Node.js 20.9 or newer** (tested with 24) and npm.
- **A container runtime:** Docker Desktop, or Colima
  (`brew install colima docker && colima start --cpu 2 --memory 4 --disk 20`).
  With Colima, keep the clone under your home folder: Colima only shares your
  home folder with its VM by default, and outside it Supabase's email templates
  are not visible and sign-in emails arrive empty.
- About 4 GB of memory for the containers, and internet access the first time
  (Docker images, npm packages, Google Fonts).

### Steps

```bash
git clone <repository-url> ting
```

```bash
cd ting && npm ci
```

```bash
npx supabase start
```

`supabase start` downloads the images on the first run, starts Postgres, Auth,
Storage, Mailpit and the API gateway, and replays every migration in
`supabase/migrations/` on an empty database.

```bash
npm run demo:local
```

`demo:local` (`scripts/demo-local.ts`):

1. Reads the local stack's address and keys from `supabase status`, and
   **refuses to continue** unless the stack answers on a loopback address. If
   `.env.local` or your shell already names a Supabase URL or service key that
   is not this local stack's, it stops before connecting to anything.
2. Writes `.env.local` with the local values, `TING_MODE=demo` and freshly
   generated showcase links — only if the file does not exist. An existing
   `.env.local` is never changed.
3. Runs the seed (`scripts/seed.ts`): 27 accounts, three communities,
   local groups, channels, posts, messages, events and notifications. It deletes and
   rewrites application rows, so run it again whenever you want a fresh demo.
4. Prints the sign-in links and every account by community and role.

```bash
npm run dev
```

Open <http://localhost:3000>. Local Supabase also serves:

| Service | Address |
| --- | --- |
| Mailpit (every email: sign-in links, password reset, invitations) | <http://127.0.0.1:54324> |
| Supabase Studio (database browser) | <http://127.0.0.1:54323> |
| API | `http://127.0.0.1:54321` |

To stop: `npx supabase stop`. `npx supabase stop --no-backup` also deletes the
local database volume.

### Demo accounts

All accounts are local fixtures with no password. There are two ways in:

- **Showcase links** – `http://localhost:3000/demo/<token>`. `demo:local`
  prints one per persona; the tokens are generated for your checkout and live
  only in your `.env.local`. They work only while `TING_MODE=demo`.
- **Email link** – any fixture account: `/login` → «Logg inn med e-postlenke»,
  enter the address, then open the link in Mailpit. A password can then be set
  under Kontoen din → Sikkerhet, after which password sign-in works too.

Tryggere Ruspolitikk and Tryggere Ungdom are a parent organisation and its
youth wing, so several people belong to both; Under The Rug is unrelated.

| Role | Community | How to sign in |
| --- | --- | --- |
| Administrator | Tryggere Ruspolitikk | Showcase link «Tryggere Ruspolitikk (admin)» |
| Administrator | Tryggere Ungdom | Showcase link «Tryggere Ungdom (admin)» |
| Moderator in both | Tryggere Ruspolitikk + Tryggere Ungdom | Showcase link «Tryggere Ruspolitikk / Tryggere Ungdom» |
| Ordinary member of both | Tryggere Ruspolitikk + Tryggere Ungdom | Showcase link «… (ordinary member)» |
| Administrator / moderator / member | Under The Rug | The three «Under The Rug» showcase links |
| Local-group leader (FTR Trøndelag) | Tryggere Ruspolitikk | Email link; the account is marked `lokallag` in the `demo:local` output |
| Group leader (Safe-Space) | Tryggere Ruspolitikk | Email link; marked `gruppe` |
| One account in two unrelated organisations | Tryggere Ruspolitikk + Tryggere Ungdom + Under The Rug | Email link; the account listed under all three |
| Signed in, no community | – | Email link; listed under «ingen fellesskap» |
| Not signed in | – | Public portals: `/tryggere-ruspolitikk`, `/tryggere-ungdom`, `/under-the-rug` |

**Platform administration** (`/platform-admin`) has no account by default. To
try it locally: sign in as any fixture account by email link, set a password
under Kontoen din → Sikkerhet, then run
`npm run platform:owner -- --email <that address> --confirm` and enrol an
authenticator app (TOTP) when the dashboard asks. See
[docs/platform-admin.md](docs/platform-admin.md) (Norwegian).

### What needs external services, and what doesn't

| Feature | Locally |
| --- | --- |
| Sign-in, password reset, email change | Works; emails land in Mailpit |
| TING's own approval/invitation email | Works with `EMAIL_PROVIDER=fil` (the default under `next dev`): written to `.vev-dev-mail/` and copied to Mailpit |
| Real email delivery (`EMAIL_PROVIDER=smtp`) | Needs an SMTP service; not needed to review anything |
| Per-network-address rate limits in Supabase Auth (`SUPABASE_SECRET_KEY`, «IP Address Forwarding») | Hosted Supabase only. The local Auth server applies no per-IP limits, so lockout behaviour cannot be exercised locally. TING's own per-account and per-address password counters do work locally |
| Leaked-password protection | Hosted Supabase only |
| Scheduled clean-up of expired messages and orphaned uploads | Run `npm run attachments:sweep` by hand; `deploy/systemd/` has the timer used on a server |
| Realtime | Not used by the app |

## Checks

```bash
npm run typecheck
```

```bash
npm run lint
```

The `check:*` suites (`scripts/check-*.ts`) exercise the database rules and
the app as real signed-in accounts against the **local** stack. Most expect a
seeded database and the app on `http://localhost:3000`; several create and
remove their own accounts and communities. Run them on a local stack you are
happy to refill — afterwards, `npm run demo:local` restores the demo data.
Useful starting points for a security review:

| Suite | What it covers |
| --- | --- |
| `check:grants` | Every table and function grant against the intended matrix, as anonymous, as members of different communities and as the service role |
| `check:private-channels`, `check:lokallag-channels` | Private and local-group channel visibility |
| `check:direct-messages`, `check:disappearing-messages`, `check:attachments` | DMs, expiry, clean-up and attachment access |
| `check:polls` | Poll visibility, anonymous votes and voter avatars |
| `check:role-management`, `check:local-group-leaders` | Admin, moderator and leader permissions |
| `check:account-security` | Passwords, email change, attempt counting |
| `check:platform-admin` | Platform roles, MFA, suspension, audit log (needs `APP_URL`) |

Known gap: `check:attachments` currently signs in as two accounts that the
seed does not create, so it fails on a freshly seeded stack («fant ikke
profilen …»). The other suites listed above pass on a fresh
`npm run demo:local` stack.

Suites that read the database directly use `docker exec` on the container
`supabase_db_vev` (the default for this repository's `supabase/config.toml`);
set `SUPABASE_DB_CONTAINER` if yours differs.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/architecture-security.md](docs/architecture-security.md) | Authentication, community isolation, RLS, privileged server operations, platform-admin boundary |
| [docs/review-guide.md](docs/review-guide.md) | Where outside reviewers are most likely to find something |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Reporting bugs, proposing changes, running checks |
| [SECURITY.md](SECURITY.md) | Reporting vulnerabilities privately |
| [docs/drift-og-oppsett.md](docs/drift-og-oppsett.md) | Full setup and operations guide: hosted Supabase, Auth settings, email/DNS, attachments, first installation (Norwegian) |
| [docs/platform-admin.md](docs/platform-admin.md) | Platform administration (Norwegian) |
| [docs/ops/post-restore.md](docs/ops/post-restore.md) | What must happen after a database restore (Norwegian) |

## Known limitations

- **No end-to-end encryption.** Message text and attachments are stored in
  plain form in Postgres and Supabase Storage. Anyone with the database
  password or the service-role key can read everything; the platform-operator
  role is a boundary inside the application, not against the people who run
  the database.
- **Disappearing direct messages** have three separate parts, and only the
  first is immediate:
  1. *Access denial* – the moment a message expires, the database stops
     returning it to both participants (enforced in RLS, no job needed).
  2. *Physical clean-up* – the text, attachments and notifications are deleted
     by `npm run attachments:sweep` (`purge_expired_direct_messages()`) and when
     the conversation is opened. Until the sweep runs, expired rows still exist
     in the database and storage.
  3. *Backups* – a deleted message can survive in database backups until those
     backups expire. Retention of the hosting provider's backups has not been
     verified, and restoring a backup requires the procedure in
     `docs/ops/post-restore.md`, or expired messages become readable again.
     The feature must not be described as "deleted everywhere".
- **Rate limits** that depend on hosted Supabase settings (IP forwarding,
  per-IP Auth limits) are untested outside a local stack.
- **Pre-pilot.** No external security audit, no load testing, and the schema
  is still changing. Account-level pages are Norwegian only.

## Licence

TING's source code is licensed under the **GNU Affero General Public License,
version 3 or (at your option) any later version** (AGPL-3.0-or-later). The full
text is in [LICENSE](LICENSE); the notice and exclusions are in
[NOTICE.md](NOTICE.md).

In practice: you may run, study, change and share the code. If you distribute a
copy or a modified version, you must do so under the same licence and provide
the corresponding source. The AGPL's extra condition (section 13) applies to a
**modified version** that users interact with remotely over a network, such as a
hosted fork: you must prominently offer those users the corresponding source of
your modified version, at no charge, from a network server. It does not require
publishing anything if you only run the unmodified code, and it covers source
code, not your data. This summary is not legal advice; the licence text governs.

**Not covered by the code licence:** organisation names, logos, photographs and
the people and personal data in the fixtures (Tryggere Ruspolitikk, Tryggere
Ungdom, Under The Rug). They are included with their owners' permission for
local review of TING. That permission does not grant downstream reuse: do not
redistribute them or use them in a derived service, and replace them in a fork.
Do not send email to the fixture addresses (the local demo delivers everything
to Mailpit).

Third-party dependencies keep their own licences; see
[NOTICE.md](NOTICE.md#third-party-software).
