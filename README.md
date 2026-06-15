# lavasecurity/.github

Org-level defaults for Lava Security. Currently hosts the **reusable security
workflow** that every repo calls instead of maintaining its own copy.

## Reusable security backstop

[`.github/workflows/security.yml`](.github/workflows/security.yml) is a
`workflow_call` workflow with per-scanner toggles. Repos opt into only what they
need:

| Scanner | Input | Where it's used |
| --- | --- | --- |
| **gitleaks** (secret scan) | `gitleaks` (default `true`) | every repo |
| **Semgrep OSS** (JS/TS SAST) | `semgrep` | `lavasec-infra` (Workers TS) |
| **mobsfscan** (mobile SAST) | `mobsfscan` | `lavasec-ios`, `lavasec-android` (once code lands) |
| **actionlint** (workflow lint) | `actionlint` | `lavasec-runner` (privileged release CI) |

Aikido's single free seat covers `lavasec-infra` (highest-risk app logic; CodeQL
isn't free on private repos), so the free scanners above backstop the other repos.

### How repos use it today (Free plan)

GitHub **Free does not allow private repos to call a reusable workflow in another
private repo** (that needs GitHub Team), and making this repo public would expose
the org's structure pre-launch. So for now **each repo carries a self-contained
copy** of `security.yml` with only the scanner jobs it needs — works on Free,
stays 100% private, and keeps every repo self-contained (more split-resilient).

This file is the **canonical template**: keep the per-repo copies in sync with it.
No secrets are required — every scanner runs on free, public, no-auth tooling.

### Later: consolidate to a true reusable workflow

Once the org is on **GitHub Team**, or once the consuming repos are **public**,
replace each repo's copy with a one-line caller and this becomes the single source:

```yaml
# .github/workflows/security.yml
name: Security
on:
  push: { branches: [main] }
  pull_request: {}
jobs:
  security:
    uses: lavasecurity/.github/.github/workflows/security.yml@main
    with:
      gitleaks: true
      semgrep: true   # only on app-logic repos
```

### Notes

- **Dependency updates are not centralizable** via `workflow_call`; each repo
  commits its own `.github/dependabot.yml` (templated, not shared).
- Per-repo **build/test gates** (e.g. `swift test`, `mkdocs build --strict`,
  `tsc --noEmit && node --test`) stay in each repo — they genuinely differ.
- Follow-up hardening: SHA-pin the third-party actions/images referenced here.
