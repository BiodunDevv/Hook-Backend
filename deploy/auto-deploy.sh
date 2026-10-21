#!/usr/bin/env bash
# Pull-based continuous deployment, run every 2 minutes by a systemd timer.
# When main has a new commit whose GitHub checks all passed, deploy it with
# deploy.sh. The server only reads from GitHub; GitHub holds no server keys.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="Hook-Deliveries/Hook-Backend"
STATE="$HOME/.hook-deployed-sha"
exec 9>"$HOME/.hook-deploy.lock"
flock -n 9 || exit 0   # a deploy is already running

sha=$(git ls-remote origin refs/heads/main | cut -f1)
[ -n "$sha" ] || { echo "could not read origin/main"; exit 1; }
[ "$sha" = "$(cat "$STATE" 2>/dev/null)" ] && exit 0

# Only deploy commits whose checks have all finished successfully.
verdict=$(curl -fsS "https://api.github.com/repos/$REPO/commits/$sha/check-runs?per_page=100" | python3 -c '
import json, sys
runs = json.load(sys.stdin)["check_runs"]
if not runs or any(r["status"] != "completed" for r in runs): print("pending")
elif all(r["conclusion"] in ("success", "skipped", "neutral") for r in runs): print("passed")
else: print("failed")')

case "$verdict" in
  pending) exit 0 ;;   # try again on the next tick
  failed)  echo "checks failed for ${sha:0:7}; not deploying"; echo "$sha" > "$STATE"; exit 0 ;;
esac

echo "deploying ${sha:0:7}"
deploy/deploy.sh "$sha"
echo "$sha" > "$STATE"
