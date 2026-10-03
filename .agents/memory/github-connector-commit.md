---
name: GitHub connector commit flow
description: Reconcile connector commits with the live remote branch without replacing production changes.
---

Before writing a GitHub branch, read its live ref and compare both trees from their merge base; do not assume the workspace tracking ref is current. Fetch remote commits read-only, reconcile overlapping edits, then create a commit whose first parent is the current remote head and update the ref once with `force: false`. GitHub's create-tree response with `base_tree` can show only root-level entries; verify the resulting tree recursively and compare leaf blobs before committing.

**Why:** A stale workspace tracking ref can hide newer production commits, and a tree based on it can overwrite independent remote changes. The GitHub client wraps REST responses in `data`, so inspecting the wrapper directly can make an existing SHA appear missing; another release can also advance `main` during local checks. In the sandbox, `git merge-file` with process-substitution inputs once produced a clean output that omitted the workspace-side edits. Shell Git HTTPS may also lack write credentials while the connected GitHub proxy still has repository write access.

**How to apply:** For production pushes, confirm the live branch head, merge remote-only changes, resolve overlaps, validate the combined tree, then write blobs, tree, commit, and non-forced ref update. If shell Git push is unauthenticated, use the GitHub connector's Git Data API instead: upload complete file contents, verify each returned blob SHA, create the tree from the verified live base, compare the resulting tree, then create one commit and update the ref once with `force: false`. Normalize `getClient().request()` as `response.data ?? response` before checking refs, trees, or runs. If `main` advances during validation, rebase on the latest successfully deployed head and rerun affected checks before writing. Use ordinary temporary files for all three `git merge-file` inputs and verify markers from both sides before writing. GitHub REST reads a ref at `/git/ref/{ref}` but updates it at `/git/refs/{ref}`; use the plural path for `PATCH`.

A GitHub Data API release can create a commit with a new SHA while preserving the exact local tree. CodeExecution's impure sandbox may not expose global `crypto.subtle`.

**Why:** A full tree match does not mean the remote commit history matches the local branch, and assuming otherwise can cause a later push to diverge. A missing Web Crypto global can also break a tree-check after successful read-only API calls.

**How to apply:** Compare the resulting Git tree SHA to the local `HEAD` tree SHA to verify exact content; after an API push, treat the returned remote commit SHA as authoritative. If an inventory digest is needed, import `createHash` from `node:crypto` inside the impure function.
