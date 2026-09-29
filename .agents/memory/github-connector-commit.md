---
name: GitHub connector commit flow
description: Reconcile connector commits with the live remote branch without replacing production changes.
---

Before writing a GitHub branch, read its live ref and compare both trees from their merge base; do not assume the workspace tracking ref is current. Fetch remote commits read-only, reconcile overlapping edits, then create a commit whose first parent is the current remote head and update the ref once with `force: false`.

**Why:** A stale workspace tracking ref can hide newer production commits, and a tree based on it can overwrite independent remote changes. In the sandbox, `git merge-file` with process-substitution inputs once produced a clean output that omitted the workspace-side edits.

**How to apply:** For production pushes, confirm the live branch head, merge remote-only changes, resolve overlaps, validate the combined tree, then write blobs, tree, commit, and non-forced ref update. Use ordinary temporary files for all three `git merge-file` inputs and verify markers from both sides before writing. GitHub REST reads a ref at `/git/ref/{ref}` but updates it at `/git/refs/{ref}`; use the plural path for `PATCH`.