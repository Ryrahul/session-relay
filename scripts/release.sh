#!/usr/bin/env bash
# Opens (or reuses) a PR from main to deploy. Merging it ships to production.
set -euo pipefail
git fetch origin main deploy >/dev/null 2>&1
COMMITS=$(git log --oneline origin/deploy..origin/main)
if [ -z "$COMMITS" ]; then
  echo "deploy is already up to date with main."
  exit 0
fi
EXISTING=$(gh pr list --base deploy --head main --state open --json url -q '.[0].url')
if [ -n "$EXISTING" ]; then
  echo "Release PR already open: $EXISTING"
  exit 0
fi
BODY=$(printf 'Ships these commits to production:\n\n%s\n\nMerging runs the Deploy workflow: tests, image build, database backup, deploy, health check, automatic rollback on failure.\n' "$(sed 's/^/- /' <<<"$COMMITS")")
gh pr create --base deploy --head main --title "Release $(date -u +%Y-%m-%d)" --body "$BODY"
