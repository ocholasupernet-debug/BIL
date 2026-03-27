#!/usr/bin/env bash
# Manual / auto push to GitHub
# Usage: bash push-to-github.sh ["optional commit message"]
set -e

REMOTE="github"
LOCAL_BRANCH="clean-main"
REMOTE_BRANCH="main"

# Ensure git identity is set (needed in fresh shells)
git config --local user.email "admin@ocholasupernet.com" 2>/dev/null || true
git config --local user.name  "OcholaSupernet"           2>/dev/null || true

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " OcholaSupernet → GitHub Push"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Stage and commit any uncommitted changes
STAGED=$(git status --porcelain 2>/dev/null)
if [ -n "$STAGED" ]; then
  MSG="${1:-"chore: auto-push $(date +'%Y-%m-%d %H:%M')"}"
  echo "[1/3] Staging all changes..."
  git add -A
  echo "[2/3] Committing: $MSG"
  git commit -m "$MSG"
else
  echo "[1/3] Working tree clean — nothing to commit"
  echo "[2/3] Skipped commit"
fi

echo "[3/3] Pushing $LOCAL_BRANCH → $REMOTE/$REMOTE_BRANCH..."
git push "$REMOTE" "$LOCAL_BRANCH:$REMOTE_BRANCH" --force

echo ""
echo "✅ Pushed successfully!"
echo "   https://github.com/ocholasupernet-debug/BIL/tree/$REMOTE_BRANCH"
