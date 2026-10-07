---
name: VPS deployment verification
description: Distinguish a completed VPS release from a partial GitHub Actions deployment.
---

A successful runner build, archive copy, healthy API endpoint, or updated frontend asset does not by itself prove that a VPS deployment completed. The deploy script can publish static files before later control-plane checks and the API restart, leaving frontend and backend versions mismatched when the SSH step fails.

Before deploying, identify the latest successful VPS workflow run's `head_branch` and `head_sha`, then compare that complete tree with the workspace. A manual deployment can run from a feature branch while `main` remains behind. Merge the deployed release into the workspace before updating `main`; otherwise a normal push can roll production back.

Direct SSH releases do not appear in GitHub Actions history. A direct release records source identity and build checksums in the VPS project's `.deployment-release.json`; do not assume the newest successful Actions run is still the live release.

**Why:** Direct delivery can advance the VPS without advancing GitHub refs. Deploying an older repository tree afterward can remove live fixes, and the direct-release marker can itself become stale after another archive deployment.

**How to apply:** Compare actual deployed source files and build checksums with the marker before treating it as current. Preserve the verified live application changes when reconciling a later GitHub release. Keep a pre-release application backup, preserve runtime secrets, and suppress unrelated RouterOS actions for an application-only deployment.

Scoped updates over differing live source must be identified as composite releases, not as an exact checkout of the prepared patch commit.

**Why:** The live application can include unrelated fixes that are not in the prepared repository branch. Replacing the whole tree would remove those fixes, while labelling the composite as one commit would mislead the next release.

**How to apply:** Stage from verified actual live source, overlay only the requested changes, and record both patch provenance and complete source/artifact hashes. Recheck the source snapshot immediately before promotion. If it changed, reconcile the latest live additions, including shared schema and migration registration changes, rather than relaxing the check or overwriting them.

Preserve retired files left by archive deployments outside active build and test source directories when reconciling a verified VPS snapshot.

**Why:** Presence on the VPS does not mean a file contributes to the running artifact. Reintroducing stale files into source directories can revive a removed public page or introduce imports/tests that rely on exports already removed from the active application.

**How to apply:** Verify each retained file's hash, keep its original path traceable in a separate source archive, and compare live behavior through the active import graph and built artifacts. Do not register archived routes or migrations. Document the archive mapping as an intentional source-layout difference, not a loss of live behavior.

Commit reconciliation imports and release guards in an ordinary commit, not only as merge-commit content.

**Why:** Completion can rebase a task branch onto the shared project base. Merge-only snapshot additions were omitted by that rebase even though GitHub had the complete verified tree, leaving the task branch without its archive and deployment guard.

**How to apply:** After incorporating the live repository head, ensure newly imported snapshot files and task-authored guards are represented in a non-merge commit. Recheck the local and GitHub release trees after completion feedback before editing or retrying completion.

Build the application off the VPS and upload verified artifacts. Do not run a full frontend build alongside the production API on this memory-constrained server.

**Why:** The server has roughly 1 GB RAM; a frontend staging build exhausted memory and swap and temporarily made the running API unresponsive. Package-manager execution in a copied workspace also triggered automatic installation and dependency pruning when production dependencies were linked into staging.

**How to apply:** Build the reconciled live-source composite in the workspace or CI, verify the frontend configuration matches production without exposing its values, and checksum the delivered artifacts. Keep production dependencies out of writable installation targets; use existing tool binaries directly or isolated build dependencies. All release paths should share a server-side deployment lock, since unrelated live source changes can arrive during staging.

During branch reconciliation, pause preview processes that generate tracked files and recheck the branch head and working tree after switching. Automatic checkpoints can create a new commit between an earlier clean-status check and the merge.

If the management VPN bootstrap reports `TUNSETIFF` with “Device or resource busy,” treat it as an interface ownership conflict. A healthy compatibility `openvpn@` unit may already own the management TUN while a duplicate `openvpn-server@` instance fails; verify its config, address, and listener before changing units.

The GitHub connector's filtered Actions run list can lag direct run lookup; confirm the deployment run and compare its head SHA with the live branch ref rather than trusting the list alone.

Long synchronous RouterOS provisioning can be interrupted by the deploy's PM2 restart. Since the assignment row is written before RouterOS calls, interruption can leave a pending row without an error while the browser receives an HTML proxy response. A single-fork API needs graceful request draining, and persisted in-flight rows need a guarded recovery path.

**Why:** A partial release can make the site look updated while new API routes are still absent. The GitHub connector may expose run status and generic check annotations but deny access to action log archives, so the actual remote failure can remain unknown. Piping a large minified bundle to `grep -q` under `pipefail` can also return a false missing-marker result when the upstream gets SIGPIPE. A live preview generator and an automatic checkpoint can change a newly created release branch while a merge is being prepared. Another contributor can also finish a successful release during a long local validation, making an earlier remote-head check stale. Stopping the interface owner can disconnect all routers using the management VPN.

**How to apply:** Before a VPS release, compare the latest successful run's branch and SHA against the workspace and merge any production-only changes. Inspect the feature's overlapping files in the newest successful tree even when the deployment commit message is unrelated; it may have changed or reverted the behavior being staged. Recheck the remote head and successful-run status immediately before pushing; if they advanced during validation, merge the new successful tree and rerun affected checks. Recheck the new branch's parent, staged files, and worktree after pausing generators; never discard an unexpected checkpoint without inspecting it. After one push-triggered run, confirm its conclusion and inspect the exact live feature behavior in addition to `/`, a direct SPA route, and API health. Read large bundles to a file or use a non-short-circuiting scanner when checking markers. If the SSH step fails and its log is inaccessible, ask for the redacted final error lines; do not bypass control-plane checks or claim the release is complete. For long RouterOS mutations, persist the in-flight state, drain the API on shutdown signals, set PM2's kill timeout beyond the drain deadline, and allow stale work to be retried only after a freshness/concurrency check. Treat non-JSON proxy responses as an unknown outcome until persisted state is reloaded. For a busy tunnel, preserve a verified 10.8.5.x/10.8.6.x service and prevent a duplicate unit from claiming its TUN. A workflow can still have deployed its application before its final status turns to failure if an optional post-deploy RouterOS check fails; confirm the explicit completion and health-check logs, preserve that exact SHA in the release tree, and don't rerun the optional router action as part of an unrelated release.