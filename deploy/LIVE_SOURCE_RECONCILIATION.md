# Verified live source reconciliation

The live application delivered on 2026-10-07 is a composite, not an exact
checkout of a GitHub commit. It combines the loyalty patch with the newer
voucher restoration release and files retained by earlier archive deployments.

## Evidence

- Verified VPS marker: `/var/www/ocholasupernet/.deployment-release.json`.
- Direct release time: `2026-10-07T02:37:45.158165+00:00`.
- Loyalty patch: `92dbb54c4260b83b1d94b9b3ce9ff00c920a5668`.
- GitHub voucher release: `b947f7108f6a5143f6772273669b1cb943070620`.
- Source manifest SHA-256:
  `ff0349b8185adc2b471af254328503da9007ab1b8040174fb0d6e12a9107ada7`.
- All 766 recorded source entries and 299 build artifacts matched their actual
  VPS hashes during reconciliation. Runtime environment files were not copied.
- The repository was compared against every recorded source entry, not only
  the changed feature files. The 24 retired live-only files are preserved
  byte-for-byte under `deploy/retained-vps-source/<original-path>`, outside
  active source folders. They are not added to route registration or navigation.
- The shared schema and deployment migration runner preserve both loyalty
  and voucher data entitlement changes.
- This archive includes the obsolete static Hotspot error page and legacy
  script/migration implementations. Restoring them to active source folders
  would break current type checks and portal validation. Keeping them outside
  those folders preserves the snapshot without reviving removed behavior.

## Final recheck after the voucher diagnostics update

While workflow authorization was being renewed, a separate release added
voucher-list diagnostics to GitHub and the VPS. Those changes are retained.
The original direct-release marker is now stale: four source files and eleven
recorded artifacts differ from it. The marker was not rewritten or treated as
proof of the newer release.

The actual live-source inventory was compared again: 788 entries matched
repository contents (including the 24 archived originals). The remaining
differences are intentional additions to the workflow fingerprint checks,
claimed-voucher deletion protection, this report, and the release-source guard.
Repository-only tests and the consumed one-time skip marker are not live
application regressions.

The latest actual build-artifact inventory contains 300 files. Its SHA-256
digest, calculated from the sorted-key JSON inventory with a trailing newline,
is `142e7a124121bd899d85f2848713aa1b2b78c242c550852428e308d8b1a7c2f8`.
This is an audit of the latest observed VPS files, not a claim that the
repository-only deletion fix or workflow pins have been deployed.

## Release checks

Run the source-wiring guard:

```sh
node --test deploy/tests/hotspot-release-source.test.mjs
```

Run the behavioral checks:

```sh
pnpm --filter @workspace/api-server exec tsx --test \
  src/lib/loyalty-points.test.ts \
  src/lib/hotspot-voucher-status.test.ts \
  src/lib/hotspot-voucher-restore.test.ts \
  src/lib/hotspot-voucher-utils.test.ts \
  src/routes/hotspot-voucher-deletion.test.ts
pnpm --filter @workspace/api-server run test:tenant-vouchers
```

The deployment script runs the source guard before database migrations or API
restart. These checks do not load production credentials or contact routers.

## Boundaries

This reconciliation does not deploy the application or execute RouterOS
actions. Repository reconciliation commits must use `[skip ci]` on `main`
because a normal push triggers the VPS deployment workflow.

The Actions workflow must retain the prepared SSH host-fingerprint pins in both
transfer and deployment steps. Publishing those pins needs authorized
workflow-write access; do not remove them to work around a permission failure.

The repository additionally protects claimed vouchers from deletion before
their first RADIUS accounting session. Both deletion endpoints use the same
guard, and the regression tests use injected storage without database writes.

The VPS release marker remains a record of the direct release. Do not rewrite
it to identify the repository reconciliation commit as already deployed.
Recheck actual source and artifact hashes before the next production release:
neither the newest Actions run nor this report alone proves what is live then.

The existing one-time RouterOS skip marker remains in repository release source
as a safety measure. Its absence from the live snapshot reflects consumption by
an earlier deployment, not a missing application feature.
