---
name: Gateway email OTP recipient
description: Recipient and verification rules for tenant payment-settings email codes.
---

Send payment-settings OTPs to the signed-in tenant admin’s account email, not to the shared Super Admin security-alert mailbox. The platform SMTP identity is only the sender; entering the code proves access to that account inbox.

**Why:** The user explicitly chose email verification to the verified admin rather than a shared administrative address.

**How to apply:** Keep gateway OTP recipient resolution server-side and bound to the account, request, and session. Require the email OTP channel and working platform SMTP; do not accept a browser-supplied recipient.
