---
name: VPS deployment verification
description: Distinguish a completed VPS release from a partial GitHub Actions deployment.
---

A successful runner build, archive copy, healthy API endpoint, or updated frontend asset does not by itself prove that a VPS deployment completed. The deploy script can publish static files before later control-plane checks and the API restart, leaving frontend and backend versions mismatched when the SSH step fails.

Before deploying, identify the latest successful VPS workflow run's `head_branch` and `head_sha`, then compare that complete tree with the workspace. A manual deployment can run from a feature branch while `main` remains behind. Merge the deployed release into the workspace before updating `main`; otherwise a normal push can roll production back.

During branch reconciliation, pause preview processes that generate tracked files and recheck the branch head and working tree after switching. Automatic checkpoints can create a new commit between an earlier clean-status check and the merge.

If the management VPN bootstrap reports `TUNSETIFF` with “Device or resource busy,” treat it as an interface ownership conflict. A healthy compatibility `openvpn@` unit may already own the management TUN while a duplicate `openvpn-server@` instance fails; verify its config, address, and listener before changing units.

**Why:** A partial release can make the site look updated while new API routes are still absent. The GitHub connector may expose run status and generic check annotations but deny access to action log archives, so the actual remote failure can remain unknown. Piping a large minified bundle to `grep -q` under `pipefail` can also return a false missing-marker result when the upstream gets SIGPIPE. A live preview generator and an automatic checkpoint can change a newly created release branch while a merge is being prepared. Stopping the interface owner can disconnect all routers using the management VPN.

**How to apply:** Before a VPS release, compare the latest successful run's branch and SHA against the workspace and merge any production-only changes. Recheck the new branch's parent, staged files, and worktree after pausing generators; never discard an unexpected checkpoint without inspecting it. After one push-triggered run, confirm its conclusion and inspect the exact live feature behavior in addition to `/`, a direct SPA route, and API health. Read large bundles to a file or use a non-short-circuiting scanner when checking markers. If the SSH step fails and its log is inaccessible, ask for the redacted final error lines; do not bypass control-plane checks or claim the release is complete. For a busy tunnel, preserve a verified 10.8.5.x/10.8.6.x service and prevent a duplicate unit from claiming its TUN.