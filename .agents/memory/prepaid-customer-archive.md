---
name: Prepaid customer archive
description: Safety boundary for hiding expired prepaid accounts without changing financial history.
---

Archive only expired prepaid customer rows with a reversible timestamp marker; an entitled active or payment-pending user must never be hidden. Clear stale archive markers when a user becomes entitled or is restored. Do not delete the customer or alter, detach, or rewrite any linked transaction field. Keep a preview before batch archive and provide a restore path.

**Why:** The user explicitly required reversible cleanup that preserves transaction history and said active users must always remain visible in Prepaid Users.

**How to apply:** For archive, restore, and purchase-renewal paths, validate tenant ownership and current entitlement on the server. Entitled accounts stay visible; expired cleanup preserves transaction linkage and values.
