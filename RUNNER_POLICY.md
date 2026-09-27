# CI runner policy

All Linux jobs use fixed Ubicloud runner labels, including public repositories,
fork PRs, scope detection, security scans, code review, and release helpers.
Use `ubicloud-standard-2` for light jobs and `ubicloud-standard-4` for Android
builds and emulator tests. Do not add GitHub-hosted fallbacks or runner-selection
variables that bypass this policy. Missing capacity leaves a job queued or failed.

Xcode jobs use `[self-hosted, macOS]`. Persistent Macs execute only trusted
same-repository branches. Fork PRs need review and a same-repository branch before
native validation; Linux checks report this requirement rather than treating
skipped native validation as success. Each repository needs a registered Mac runner
or access to an organization runner group; another repo's registration is insufficient.

Reusable security and review workflows follow the same policy. Consumers pin a
reviewed commit containing it; old pins retain their old routing. Actionlint's
configuration lists the permitted Ubicloud labels.

Old runner-selection variables are no longer read. Historical cost plans describing
GitHub-hosted fallback routes are superseded by this policy.

## Shared workflow rollout

Merge the initial runner-policy PR with a merge commit (not squash/rebase), so its
pinned `bbba4b6150d8b2674453e8fe47a835fd423b6b4c` revision remains reachable from
`main`. Keep the source branch until that merge completes. Subsequent policy
updates must use a reviewed, reachable immutable revision in every caller.

Public and fork Linux jobs intentionally use managed Ubicloud's disposable VMs.
[Ubicloud documents one clean VM and JIT runner per job](https://www.ubicloud.com/docs/github-actions-integration/security),
with the VM and disk removed afterward. This policy does not permit a persistent
Linux host behind an Ubicloud label. Fork runs retain read-only tokens and no
release credentials; privileged code review still rejects fork heads before use.
