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
