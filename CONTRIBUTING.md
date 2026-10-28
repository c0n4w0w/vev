# Contributing

Thanks for looking at TING. The project is pre-pilot and maintained by one
person, so the most useful contributions right now are careful bug reports
from a local installation.

## Ground rules

- **Test only your own local installation**, or a test environment the
  maintainer has explicitly named to you. Never test against join-ting.no,
  any other production deployment, or infrastructure you do not own.
- **Use synthetic data.** The local demo (`npm run demo:local`) gives you
  accounts in every role. Do not put real personal data into issues, fixtures
  or screenshots.
- **Security vulnerabilities are not issues.** If a bug lets someone read,
  change or delete something they should not — another community's content, a
  private channel, someone else's DMs or attachments, an admin power, platform
  administration — report it privately as described in
  [SECURITY.md](SECURITY.md). Everything else is an ordinary bug.

## Setting up

Follow [README → Run a local demo](README.md#run-a-local-demo). In short:

```bash
npm ci
```

```bash
npx supabase start
```

```bash
npm run demo:local
```

```bash
npm run dev
```

## Reporting a bug

Open a GitHub issue with:

1. **Commit** you tested (`git rev-parse --short HEAD`).
2. **Account and role** you were signed in as (fixture handle, e.g. the
   moderator showcase), and the community.
3. **Steps to reproduce** from a freshly seeded demo
   (`npm run demo:local`), as short as possible.
4. **Expected and actual** behaviour. Screenshots are welcome if they show
   only fixture data.
5. Browser and OS if it is a display problem; relevant server output
   (`npm run dev` log) if something fails.

## Proposing a change

1. Open an issue first for anything larger than a small fix, so we can agree
   on the approach — the database rules are deliberate and often subtle.
2. Keep each change focused. Schema changes go in a **new** migration in
   `supabase/migrations/` (never edit one that has been applied); a new table
   must grant itself to the roles that use it and be added to
   `scripts/check-grants.ts`.
3. After a migration, regenerate the types:
   `npx supabase gen types typescript --local > lib/supabase/database.types.ts`.
4. Run the checks below and say in the pull request which ones you ran.
5. Interface text goes in both `lib/i18n/nb/` and `lib/i18n/en/`; `en` is
   typed against `nb`, so a missing translation is a type error.

The code is licensed under AGPL-3.0-or-later (see the README and
[LICENSE](LICENSE)); by submitting a contribution you agree that it is licensed
under those terms. Do not contribute logos, photographs or personal data you do
not have the right to license this way.

## Checks

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npx supabase db reset
```

`db reset` replays every migration on an empty local database (it deletes the
local data; follow it with `npm run demo:local`). Then run the `check:*`
suites relevant to your change, with the app running on
<http://localhost:3000>, for example:

```bash
npm run check:grants
```

The README lists the suites most relevant to security. Several suites create
and remove their own accounts and data; run them on a local stack you can
re-seed.
