---
name: Prepaid customer archive
description: Safety boundary for hiding expired prepaid accounts without changing financial history.
---

Archive prepaid customer rows with a reversible timestamp marker; do not delete the customer or alter, detach, or rewrite any linked transaction field. Keep a preview before batch archive and provide a restore path.

**Why:** The user explicitly required that expired prepaid cleanup leave transactions untouched and approved reversible archiving instead of deletion.

**How to apply:** For future expired-prepaid cleanup, preserve transaction linkage and values; validate tenant ownership and expiry again on the server before applying the archive marker.
