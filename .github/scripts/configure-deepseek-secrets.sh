#!/usr/bin/env bash
set -euo pipefail

# Run interactively. Keep the key out of command arguments, logs, and shell history.
# The separate name leaves existing Go credentials untouched during migration.
if [ ! -t 0 ]; then
  echo 'Run this script interactively in a terminal.' >&2
  exit 1
fi
gh auth status --hostname github.com >/dev/null 2>&1
trap 'unset review_api_key' EXIT
read -r -s -p 'DeepSeek API key: ' review_api_key
printf '\n' >&2
if [ -z "$review_api_key" ]; then
  echo 'No key entered; no secrets changed.' >&2
  exit 1
fi
for review_repo in .github lavasec-ios lavasec-ios-internal lavasec-android-internal lavasec-web lavasec-infra lavasec-runner; do
  printf '%s' "$review_api_key" | gh secret set OCR_DEEPSEEK_AUTH_TOKEN --repo "github.com/lavasecurity/$review_repo"
  printf 'Configured DeepSeek credential: lavasecurity/%s\n' "$review_repo"
done
