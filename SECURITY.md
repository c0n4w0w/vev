# Security policy

TING is pre-pilot software. It has not had an external security audit, and it
does not use end-to-end encryption. Reports of anything that weakens the
isolation between communities, accounts or roles are very welcome.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security
problem.**

> **DRAFT – reporting channel not live yet.** This box must be replaced before
> the repository is made public.
>
> - **GitHub private vulnerability reporting** is the intended route (repository
>   **Security → Advisories → Report a vulnerability**). It is **not enabled**:
>   the repository is private and GitHub's settings API reports it as unavailable.
>   After publication, the maintainer enables it under **Settings → Code security
>   → Private vulnerability reporting** and then confirms that the button appears
>   for a non-collaborator account and that notifications reach the maintainer.
> - **No security email address exists**, and none is documented here.
>
> Until a route is confirmed working, do not publish this repository.

Please include:

- The **commit** you tested (`git rev-parse --short HEAD`).
- **Where** you tested: your own local installation, or a test environment the
  maintainer named to you.
- **Steps to reproduce** from a freshly seeded local demo, the account/role
  used, and a **minimal proof of concept** (a request, a script, or SQL run as
  the `authenticated` role).
- The **impact**: what an attacker could read, change or delete, and what
  access they need first.

You should get an acknowledgement within a week. The maintainer will confirm
whether the issue is reproducible, agree a fix and a disclosure date with you,
and credit you if you want to be credited.

## Scope

In scope: this repository's code running on **your own local installation**
(see the README), or a test environment the maintainer has explicitly
designated to you in writing.

Out of scope unless the maintainer has explicitly authorised it in writing:

- Any production deployment, including join-ting.no and its demo deployment.
- Data belonging to real communities or people.
- Third-party infrastructure: Supabase, hosting providers, email providers,
  GitHub.

## Rules for testing

- Use synthetic accounts and data only (`npm run demo:local` creates them).
- No denial-of-service or load testing, spam, social engineering, physical
  attacks, or destructive testing against anything you do not own.
- If you come across real personal data, credentials or keys, **stop**, do not
  copy, use or share them, and report privately straight away.
- Give the maintainer reasonable time to fix an issue before disclosing it.

## Supported versions

Only the latest commit on `main` is supported. There are no releases yet.

## Known, documented limitations

These are known and documented in the README and
[docs/architecture-security.md](docs/architecture-security.md); reports that
only restate them are not vulnerabilities, but reports showing they are worse
than described are:

- Messages and attachments are not end-to-end encrypted; the database operator
  and anyone with the service-role key can read everything.
- Expired disappearing messages are denied immediately but deleted physically
  only when the clean-up runs, and may persist in backups until those expire.
- Hosted-only protections (Supabase per-IP Auth rate limits, IP forwarding,
  leaked-password protection) cannot be exercised locally.
