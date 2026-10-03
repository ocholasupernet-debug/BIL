# Hotspot file replacement recovery

Use this procedure if a RouterOS fetch is interrupted while replacing portal
files. Treat the destination as incomplete even if RouterOS lists it.

## Restore missing approved assets

In File Manager, use **Install hotspot files** to add missing approved assets
to `flash/hotspot`; existing files are skipped. Do not use **Replace hotspot
files** just to restore missing files, because replacement overwrites matching
assets and does not make an automatic backup. Replacing the approved portal
files requires an authenticated Super Admin session and an explicit approval
for that action; regular admins can install missing files only.

The File Manager does not expose a delete action for approved portal assets.
Any future delete or access-blocking action must use the same Super Admin
approval boundary.

## Recover an interrupted fetch

1. Keep the active Hotspot profile pointed at its last known-good
   `html-directory`.
2. Only a Super Admin, after explicitly approving this cleanup, may remove the
   exact destination file from the interrupted fetch in RouterOS Files. Without
   that approval, leave the partial file in place and ask a Super Admin to
   review it. Do not remove the whole Hotspot directory or unrelated assets.
3. Retry that asset from the File Manager and confirm the replacement
   completed. Compare the destination with the source file where possible.
4. Load the portal from a client and check the login page and its required
   assets before changing the profile path.
5. If the fetch replaced a file in the currently active directory, restore
   that file from a known-good copy or the approved portal source before
   reconnecting clients.

## Moving a router to `flash/hotspot`

Deploy and verify the portal in `flash/hotspot` while the old `hotspot/`
directory remains available. Change the Hotspot profile to
`html-directory=flash/hotspot` only after all required assets are present and
a real client loads the portal. Remove the old directory only after that
profile change and client test both succeed, and only with explicit Super Admin
approval.

The procedure is documented, but the test MikroTik transfer and live-client
verification are still pending.