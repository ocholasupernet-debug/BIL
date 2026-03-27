#!/usr/bin/env bash
# Manual push to GitHub
# Usage: bash push-to-github.sh [commit message]
set -e

REMOTE="github"
LOCAL_BRANCH="clean-main"
REMOTE_BRANCH="main"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " OcholaSupernet → GitHub Push"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Stage and commit any uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet || git ls-files --others --exclude-standard | grep -q .; then
  MSG="${1:-"chore: auto-push $(date +'%Y-%m-%d %H:%M')"}"
  echo "[1/3] Staging all changes..."
  git add -A
  echo "[2/3] Committing: $MSG"
  git commit -m "$MSG" || true
else
  echo "[1/3] Working tree clean — nothing to commit"
  echo "[2/3] Skipped commit"
fi

echo "[3/3] Pushing $LOCAL_BRANCH → $REMOTE/$REMOTE_BRANCH..."
git push "$REMOTE" "$LOCAL_BRANCH:$REMOTE_BRANCH" --force

echo ""
echo "✅ Pushed successfully!"
echo "   https://github.com/ocholasupernet-debug/BIL/tree/$REMOTE_BRANCH"
