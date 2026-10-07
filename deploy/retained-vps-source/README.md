# Retained VPS-only source

These 24 files were present in the fingerprint-verified VPS source snapshot
but absent from the current repository's active release source. Archive-based
deployments had left retired files behind. Their SHA-256 hashes were checked
against the live `.deployment-release.json` before importing them.

Each file is stored at `<this directory>/<original repository-relative path>`
with its contents unchanged. Nothing here is imported by the running API,
frontend, migration runner, or test commands.

Do not move these files back into active source directories merely because
they were present on the VPS. Several refer to removed exports, and the old
Hotspot error page is explicitly prohibited by current portal build validation.
See `deploy/LIVE_SOURCE_RECONCILIATION.md` for the source provenance.
