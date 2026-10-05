#!/usr/bin/env bash

set -Eeuo pipefail

site_dir="/mnt/user/appdata/basvroegop-site"
lock_file="/tmp/basvroegop-site-publish.lock"

exec 9>"$lock_file"
flock -n 9 || exit 0

cd "$site_dir"

git add -- content
if ! git diff --cached --quiet -- content; then
  timestamp="$(date --iso-8601=seconds)"
  git commit -m "Update publications from Obsidian ($timestamp)"
fi

if git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
  git fetch origin main
  git rebase origin/main
fi

git push --set-upstream origin main
