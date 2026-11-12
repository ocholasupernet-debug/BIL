# Static corporate site fallback

`static-site/` contains a public-only fallback. It does not provide the
corporate API, saved-content editing, administrator login, or inquiry storage.

The live site uses the isolated Node backend described in
`corporate-release/deploy/DEPLOYMENT.md`. Do not replace the live Nginx proxy
with `corporate-release/deploy/isplatty-org-static.nginx.conf` during ordinary
updates: doing so would disable the live content API and admin host.

Use the static fallback only for an intentional, separately verified rollback.
It serves the public `.org` pages while the exact admin hostname returns 404.
