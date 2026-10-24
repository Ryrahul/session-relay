#!/usr/bin/env bash
# Copies full transcripts from a Docker install's transcripts volume into an R2 bucket.
#   scripts/copy-transcripts-to-r2.sh <transcripts dir> <bucket>
# Keys keep their layout (<org_id>/<session_id>.json.gz), so the database dump still matches.
set -euo pipefail
SRC="${1:?usage: copy-transcripts-to-r2.sh <transcripts dir> <bucket>}"
BUCKET="${2:?usage: copy-transcripts-to-r2.sh <transcripts dir> <bucket>}"
cd "$SRC"
n=0
while IFS= read -r -d '' f; do
  key="${f#./}"
  npx --yes wrangler r2 object put "$BUCKET/$key" --file "$f" --remote --content-type application/gzip >/dev/null
  n=$((n + 1))
done < <(find . -type f -name '*.json.gz' -print0)
echo "Copied $n transcript(s) to r2://$BUCKET"
