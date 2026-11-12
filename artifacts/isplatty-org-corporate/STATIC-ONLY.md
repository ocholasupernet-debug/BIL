# Static corporate site mode

This mode serves the supplied public ISPLATTY.ORG release from
`static-site/`. It does not start the corporate API or provide administrator
login, content editing, media uploads, or inquiry persistence.

The static deployment must not include `admin.html` or its admin-only bundle.
`chrisphine3.isplatty.org` should return 404, not fall through to BIL or expose a
login page. The static Nginx template is a proposal only; it must be reconciled
with the live host configuration before installation. It changes only the exact
corporate hosts and leaves `isplatty.com` and non-conflicting BIL tenant hosts
untouched.

The public bundle still contains inquiry-form UI that expects `/org-api`.
Without a backend, submissions cannot be stored or confirmed. Do not present the
site as fully operational until the form is removed/disabled or a separately
approved submission service is provided.

For the Replit subpath preview, `public/site/` is a preview copy with path
adjustments. For VPS static hosting, use the unmodified files in `static-site/`
as the document root; do not deploy the React iframe wrapper.
