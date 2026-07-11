# Security Policy

Thanks for helping keep Lava Security and the people who rely on it safe. This is the
default policy for every Lava Security repository; a repo may publish its own
`SECURITY.md` that takes precedence.

## Reporting a vulnerability

**Please don't open a public issue, pull request, or discussion for a security problem** —
that discloses it to everyone before there's a fix.

Report it privately, either way:

- **GitHub** — use **Report a vulnerability** on the affected repo's **Security ▸ Advisories**
  tab (where private reporting is enabled). This keeps the report and the fix in one place.
- **Email** — **security@lavasecurity.app**.

Both routes, plus a machine-readable [`security.txt`](https://lavasecurity.app/.well-known/security.txt),
are linked from **<https://lavasecurity.app/security>**.

Helpful to include:

- What the issue is and what an attacker could do with it.
- Steps to reproduce, or a proof of concept.
- The affected repo, app version / commit, and platform (e.g. iOS version, device).

## What to expect

We're a small team, so this is best-effort rather than an SLA: we aim to **acknowledge a
report within a few business days**, keep you updated on remediation, and credit you if
you'd like once a fix ships. Please give us a reasonable window to fix an issue before any
public disclosure — we'll work with you on timing (coordinated disclosure).

## Scope

Lava's promise is that browsing domains aren't routinely uploaded, so anything that would
weaken that — unexpected data collection, a way to exfiltrate DNS queries or account data,
a bypass of on-device filtering — is squarely in scope alongside the usual classes
(auth, injection, secret exposure, RCE).

The public iOS client lives in
[`lavasec-ios`](https://github.com/lavasecurity/lavasec-ios); backend and infrastructure
are in private repositories. Report issues in any of them to the address above — you don't
need to know which repo is at fault.
