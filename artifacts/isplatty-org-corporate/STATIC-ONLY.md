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

## VPS prerequisites

The existing HTTP default vhost already serves ACME challenges from
`/var/www/letsencrypt`; keep it in place and do not add a second port-80 vhost
for the corporate names. The current `isplatty.org` certificate covers only
`isplatty.org` and `www.isplatty.org`. Before enabling the proposed HTTPS
configuration, issue a separate certificate that also covers
`chrisphine3.isplatty.org`, using the existing webroot challenge:

```sh
sudo certbot certonly --webroot -w /var/www/letsencrypt \
  --cert-name isplatty-org-corporate \
  -d isplatty.org -d www.isplatty.org -d chrisphine3.isplatty.org
```

This creates a separate certificate lineage and does not replace the existing
`.org` certificate. Stage the static bundle at
`/var/www/isplatty-org/static-site`, then replace only the existing exact
`isplatty.org`/`www.isplatty.org` HTTPS proxy block and add the exact
`chrisphine3.isplatty.org` 404 block. Preserve the existing port-80 ACME and
redirect block, `.com` configuration, and tenant-specific vhosts. Run
`nginx -t` before reloading Nginx.

For the Replit subpath preview, `public/site/` is a preview copy with path
adjustments. For VPS static hosting, use the unmodified files in `static-site/`
as the document root; do not deploy the React iframe wrapper.
