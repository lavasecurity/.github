# lavasecurity/.github

Org-level defaults for Lava Security. Hosts the **reusable security workflow** that
every active repo calls through a thin caller instead of maintaining its own copy.

## Reusable security backstop

[`.github/workflows/security.yml`](.github/workflows/security.yml) is a
`workflow_call` workflow with per-scanner toggles. Each repo opts into only the
scanners it needs:

| Scanner | Input | Where it's used |
| --- | --- | --- |
| **gitleaks** (secret scan) | `gitleaks` (default `true`) | every repo |
| **Semgrep OSS** (JS/TS SAST) | `semgrep` | `lavasec-infra` (Workers TS), `lavasec-web` |
| **mobsfscan** (mobile SAST) | `mobsfscan` | `lavasec-ios`, `lavasec-android` + their `-internal` mirrors |
| &nbsp;&nbsp;↳ SARIF → code scanning | `mobsfscan_sarif` (default `true`) | uploads on public mobile repos; auto-skips elsewhere |
| **actionlint** (workflow lint) | `actionlint` | `lavasec-runner`, and this repo's own `self-scan.yml` |

Every scanner runs on free, public, no-auth tooling — no secrets required. Aikido's
single free seat covers `lavasec-infra` (highest-risk app logic; CodeQL isn't free on
private repos); the scanners above are the free backstop for every other repo.

## How repos call it

This repo is **public**, so any repo — public or private — can call the reusable
workflow. Each consuming repo has a thin `.github/workflows/security.yml` caller:

```yaml
# .github/workflows/security.yml in a consuming repo
name: Security
on:
  push: { branches: [main] }
  pull_request: {}
jobs:
  security:
    uses: lavasecurity/.github/.github/workflows/security.yml@main
    with:
      gitleaks: true
      semgrep: true   # only on JS/TS app repos
```

### Mobile repos: grant `security-events: write`

The `mobsfscan` job uploads its SARIF to code scanning, which needs
`security-events: write`. A reusable workflow **cannot elevate beyond the token the
caller passes**, and GitHub validates a called workflow's requested permissions at
startup — before any `if:` skips a job — so the central workflow deliberately requests
**no** elevated permission of its own (otherwise every non-mobile caller would fail to
start). Mobile callers therefore grant the scope on the calling job:

```yaml
jobs:
  security:
    permissions:
      contents: read
      security-events: write
    uses: lavasecurity/.github/.github/workflows/security.yml@main
    with:
      gitleaks: true
      mobsfscan: true
```

The upload auto-skips on private repos (code scanning needs GitHub Advanced Security)
and on fork PRs (read-only token), so the grant is a harmless no-op there.

### Notes

- **This repo scans itself** via [`self-scan.yml`](.github/workflows/self-scan.yml),
  a caller of `security.yml@main` with `gitleaks` + `actionlint`. It references `@main`
  rather than a local `./` path on purpose: a local reusable reference here produced a
  zero-job `startup_failure`, whereas `@main` runs reliably.
- **Dependency updates are not centralizable** via `workflow_call`; each repo commits
  its own `.github/dependabot.yml` (templated, not shared).
- Per-repo **build/test gates** (e.g. `swift test`, `mkdocs build --strict`,
  `tsc --noEmit && node --test`) stay in each repo — they genuinely differ.
- Follow-up hardening: SHA-pin the third-party actions/images referenced here.
