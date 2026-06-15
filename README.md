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

### Calling it from a repo

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

No secrets are required — every scanner runs on free, public, no-auth tooling.

### Notes

- **Dependency updates are not centralizable** via `workflow_call`; each repo
  commits its own `.github/dependabot.yml` (templated, not shared).
- Per-repo **build/test gates** (e.g. `swift test`, `mkdocs build --strict`,
  `tsc --noEmit && node --test`) stay in each repo — they genuinely differ.
- Follow-up hardening: SHA-pin the third-party actions/images referenced here.
