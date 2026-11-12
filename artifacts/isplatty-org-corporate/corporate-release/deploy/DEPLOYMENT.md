# ISPLATTY.ORG: isolated Truehost Ubuntu VPS deployment

**Prepared instructions only. No SSH connection, VPS installation, DNS change,
certificate issuance, Nginx reload or deployment has been performed.**

The owner confirmed this VPS also runs BIL. BIL's directory, OS user, PM2 process,
port **8080**, database, credentials, environment files, Nginx files, domains and
deployment must remain untouched. Do not copy anything from BIL, even as a template.
Stop if isolation cannot be established.

## 1. Proposed resource allocation — confirm before using

| Resource | New corporate site only |
| --- | --- |
| OS account | `isplatty-org` (separate from BIL's account) |
| Root | `/var/www/isplatty-org` |
| Immutable releases | `/var/www/isplatty-org/releases/<timestamp>` |
| Active symlink | `/var/www/isplatty-org/current` |
| Persistent uploads | `/var/www/isplatty-org/shared/uploads` |
| Environment/secrets | `/etc/isplatty-org/site.env` |
| Process name | `isplatty-org-corporate.service`, a separate systemd unit |
| Bind address | `127.0.0.1` |
| Proposed local port | **8091**, ONLY if preflight proves it is unused |
| Database / DB role | `isplatty_org` / `isplatty_org` (new and dedicated) |
| Nginx file | `/etc/nginx/sites-available/isplatty-org-corporate.conf` |
| Certificate name | `isplatty-org-corporate` |
| Public hostname | `isplatty.org` |
| Admin hostname | `chrisphine3.isplatty.org` (case-insensitive) |

Do not use port 8080, change an existing PM2 app, replace the default Nginx server,
or reuse an existing database role. Do not use `pm2 restart all`, `pm2 delete all`,
`pm2 kill`, broad `rsync --delete`, broad `chown -R /var/www`, or `nginx -s stop`.

## 2. Manual prerequisites and read-only preflight

An authorized owner/operator must first have SSH access. Confirm the VPS public
IPv4 address, DNS ownership, Ubuntu release, PostgreSQL availability and available
RAM/disk/CPU. Installing packages or restarting shared services on an existing VPS
needs separate approval; this package does not do so.

The prepared preflight script is read-only:

```sh
bash deploy/preflight.sh 8091
```

Run with sufficient read access to the Nginx configuration directories; an
unprivileged incomplete result does **not** prove a hostname is unused. It checks
listeners, corporate hostname conflicts and existing corporate targets, but cannot
certify that an unrelated wildcard/default host, external proxy or service manager
does not claim the names. The operator must resolve any ownership conflict before
adding files. Never remove/rename an existing vhost automatically.

Require Node.js **24 LTS**, pnpm and PostgreSQL client. Run the corporate app as a
dedicated systemd unit, not through BIL's process manager.
Do not replace a system-wide Node installation used by BIL. If necessary install
Node only in the corporate application's private runtime directory. Before
installation, inspect `systemctl status isplatty-org-corporate.service`; if it
already exists, stop and treat this as a corporate upgrade.

## 3. Owner-managed DNS

After preflight and approval, create/update only these corporate records:

| Type | Name in the isplatty.org zone | Value |
| --- | --- | --- |
| A | `@` | Owner-confirmed VPS IPv4 |
| A | `chrisphine3` | The same owner-confirmed VPS IPv4 |

Use a low initial TTL such as 300 seconds if supported. Add AAAA records only if
the VPS's IPv6 listener, routing and firewall have been verified. An incorrect
AAAA record can break HTTPS even if IPv4 works. No record in **isplatty.com** is
needed or permitted. No wildcard is needed. Do not copy BIL's DNS records.
If using a CDN, use strict origin TLS; do not disable certificate verification.

DNS changes are manual and only after the new process passes local checks.

## 4. Build the standalone release in this project

From the project root:

```sh
pnpm --filter @workspace/isplatty-org run typecheck
BASE_PATH=/ PORT=8091 pnpm --filter @workspace/isplatty-org run release
```

Output: `generated-artifacts/isplatty-org-release/`. This includes compiled public
and admin assets, its own server, SQL, default content, a standard package.json
with exact runtime versions, and these deployment templates. It excludes BIL,
other app artifacts, environment secrets, node_modules, live DB data and uploads.
The release generator's absolute output directory is not a deployment action.

Use the supplied release archive and verify its SHA-256 checksum after transfer
over the authorized connection. Install runtime dependencies **inside this new
release only**, as the corporate OS user:

```sh
cd /var/www/isplatty-org/releases/RELEASE_TIMESTAMP
pnpm install --prod
```

`sharp` includes native image-processing code: dependencies must be installed on
the target platform, not copied from Replit's node_modules. Keep the generated
lockfile with that installed release. The root source workspace is not required
to run the release.

## 5. Create isolated permissions and secrets — manually

An operator can create a system account and the NEW paths after confirming they
do not already belong to an unrelated application. The `isplatty-org` user should
own only its own files. Suggested modes:

- `/var/www/isplatty-org` and release directories: 0750, owner `isplatty-org`.
- `shared/uploads`: 0750, owner `isplatty-org`; photos 0640.
- `/etc/isplatty-org`: 0750, root-owned, group `isplatty-org`.
- `/etc/isplatty-org/site.env`: **0600**, owner `isplatty-org`.
- `/var/log/isplatty-org`: 0750, owner `isplatty-org`; rotate these logs separately.

Nginx proxies images through Node, so it does not need direct filesystem access
to private directories. Do not make any environment file web-accessible.

Create `site.env` privately using `deploy/site.env.example`. All values are
server-side. Never paste credentials in chat, shell history, Git, screenshots or
support logs. On Replit, set `ISPLATTY_ORG_BOOTSTRAP_PASSWORD` through Secrets.
On the VPS, use a private editor/secret manager and the dedicated environment file.

Required:

- `NODE_ENV=production`, `HOST=127.0.0.1`, `BASE_PATH=/`.
- `PORT=8091` only after verifying availability.
- `ISPLATTY_ORG_DATABASE_URL`: connection to the NEW corporate database/role.
  Production deliberately refuses the generic `DATABASE_URL` fallback.
- `ISPLATTY_ORG_UPLOAD_DIR=/var/www/isplatty-org/shared/uploads`: persistent storage.
- `ISPLATTY_ORG_TRUST_LOOPBACK=true`: only when Node is bound to loopback and Nginx
  is the trusted local proxy, replacing X-Forwarded-For as in the template.
- `ISPLATTY_ORG_PUBLIC_ORIGIN=https://isplatty.org`: set only after owner domain setup.
- `ISPLATTY_ORG_BOOTSTRAP_PASSWORD`: unique temporary secret, 16–128 characters
  with uppercase, lowercase, number and symbol; no common password/company name.

Initial username is **`user`**. There is no registration route. The bootstrap secret
is hashed with salted scrypt and inserted only if no account exists. It never
overwrites a real password. First login has no content/inquiry/media access until
the password is replaced. Remove the bootstrap secret from the environment file
after successful initialization, then restart **only the corporate process**.
There is no public password-reset bypass; recovery requires an owner-authorized,
corporate-only maintenance procedure.

## 6. Fresh corporate PostgreSQL database

Ask the database administrator to create a fresh dedicated role and database. If
PostgreSQL is already installed, example interactive commands (operator only):

```sh
sudo -u postgres createuser --pwprompt isplatty_org
sudo -u postgres createdb --owner=isplatty_org isplatty_org
```

Choose the password privately; never reuse BIL's password. Do not restart the
database server, change pg_hba.conf or alter existing roles/databases without
separate review. The corporate role must have no membership/access to BIL's DB.
If network DB access is needed, use verified TLS; never set rejectUnauthorized=false.

Apply the additive schema explicitly to the **new external VPS DB**:

```sh
node --env-file=/etc/isplatty-org/site.env \
  server/migrate-vps.mjs --confirm-corporate-only
```

The migration rejects non-corporate public tables, but that is an additional
safeguard, not proof the connection is correct. Confirm DB identity independently.
No application-startup, systemd or build hook runs migrations. Replit's managed
production schema uses its own owner-approved Publish flow, not this VPS command.

## 7. Data migration and rollback safety

For a first launch, use fresh data and configure content after the first login.
If preserving existing corporate inquiry/content/photo data:

1. Confirm source and destination are **both corporate-only**, never BIL.
2. Pause corporate submissions/content edits for a short agreed maintenance window.
3. Take an encrypted, access-restricted export/snapshot of the **corporate database
   only**, using its database provider or the authorized PostgreSQL operator's
   `pg_dump` workflow. Keep it outside the web root and do not print credentials.
4. Transfer only `isplatty_org_content`, `isplatty_org_inquiries`, and
   `isplatty_org_media` data into the pre-migrated new corporate DB. Preserve UUIDs.
   Do not transfer active sessions, form tokens, rate limits or bootstrap secrets.
5. Copy only this app's uploaded WebP files into the new `shared/uploads`, preserving
   filenames and restrictive permissions. Stock images are already in the release.
6. Bootstrap a NEW VPS administrator password independently. Revoke old sessions
   by not migrating them; don't move credentials from any other app.
7. Verify inquiry counts, content version, image references, form submission,
   new-password enforcement, logout and forbidden cross-host admin access.
8. Resume corporate writes only after verification. Do not let two independent
   production corporate instances accept writes during cutover.

For future updates, snapshot/export the new corporate DB and archive its uploads
before changes, and retain the prior immutable corporate release. Backups must be
encrypted and restore-tested by the operator, outside the document root. The app
does not run backup jobs or access BIL data.

Rollback code by repointing the corporate `current` symlink to its prior release
and restarting only `isplatty-org-corporate`. Keep uploads and database intact;
these additive migrations need no destructive down migration. A prior release
may not display newly managed content. If data restoration is genuinely required,
stop only corporate writes and restore into a separate **corporate-only** database,
validate it, then update only the corporate env file. Do not overwrite a live DB,
drop tables or reverse schema changes just to roll back code.

## 8. Start and verify the new process

Point `/var/www/isplatty-org/current` at the tested new corporate release. Install
and start only the corporate systemd unit:

```sh
sudo install -o root -g root -m 0644 \
  /var/www/isplatty-org/current/deploy/isplatty-org-corporate.service \
  /etc/systemd/system/isplatty-org-corporate.service
sudo systemctl daemon-reload
sudo systemctl enable --now isplatty-org-corporate.service
sudo systemctl status isplatty-org-corporate.service --no-pager
```

The unit runs as `isplatty-org`, binds only to loopback, and has an isolated
working directory, upload write path, memory limit and restart policy. Do not
change or restart BIL's PM2 daemon.

Check locally with the exact Host header:

```sh
curl --fail -H 'Host: isplatty.org' http://127.0.0.1:8091/_health/live
curl --fail -H 'Host: isplatty.org' http://127.0.0.1:8091/_health/ready
curl --fail -H 'Host: isplatty.org' http://127.0.0.1:8091/
curl --fail -H 'Host: chrisphine3.isplatty.org' http://127.0.0.1:8091/
# Must return 404, not administrator data:
curl -i -H 'Host: isplatty.org' http://127.0.0.1:8091/org-admin-api/content
# Must return 401 without an authenticated session:
curl -i -H 'Host: chrisphine3.isplatty.org' http://127.0.0.1:8091/org-admin-api/content
```

Do not enter real passwords over HTTP. Complete login verification only after
HTTPS is installed. Local health probes can use HTTP and fixed Host headers.
Keep 8091 closed externally; Node must listen only on loopback. Do not change
existing firewall rules affecting BIL. Add rules only with explicit operator review.

## 9. Separate Nginx hosts and HTTPS

Templates are `isplatty-org.http.conf` and `isplatty-org.https.conf`. Do not blindly
copy them over existing files. The proposed certificate path intentionally names
only the corporate certificate. Confirm no conflicting certificate name exists.

1. Stage the NEW HTTP-only vhost as
   `/etc/nginx/sites-available/isplatty-org-corporate.conf`. Enable only its new
   symlink; never remove the existing default or BIL symlinks.
2. Create `/var/www/isplatty-org/acme/.well-known/acme-challenge` with appropriate
   read-only webroot access for certificate validation. Check public DNS and port 80.
3. Run `sudo nginx -t`. Reload gracefully only after it passes and the owner has
   approved the live change. A graceful reload is shared infrastructure work; none
   has been done by this workflow.
4. Obtain a NEW certificate without Certbot's automatic Nginx edits:

```sh
sudo certbot certonly --webroot -w /var/www/isplatty-org/acme \
  --cert-name isplatty-org-corporate \
  -d isplatty.org -d chrisphine3.isplatty.org
```

5. Replace only the new corporate vhost with the HTTPS template after the certificate
   exists. Verify its corporate port. Test `nginx -t` again before a graceful reload.
6. Test HTTPS for both exact hostnames, including uppercase admin hostname handling.
   The admin host must show only admin login/dashboard; `/services` there returns
   404 and `/org-api` there is blocked. The public host must keep serving the public
   site and deny `/org-admin-api` and `/admin`. There is no wildcard/default server
   added by these templates.
7. Confirm renewal for this webroot/certificate using the provider's normal Certbot
   setup. Don't replace existing renewal hooks or certificates used by BIL.

Host-only `__Host-` administrator cookies are always Secure, HttpOnly and
SameSite=Strict, scoped to Path=/ with no Domain. Production admin has no framing,
noindex/no-store headers, origin validation and synchronizer-token CSRF protection.
Absolute authenticated sessions last 2 hours, idle sessions 30 minutes, and
bootstrap/pre-authentication sessions 15 minutes. Session polling does not extend
idle expiry. Password change revokes other administrator sessions.

## 10. Acceptance checklist before any public cutover

- BIL's existing app/config/DB/PM2/8080/domains remain unchanged.
- New corporate port is confirmed free and loopback-only; dedicated OS/DB users.
- Both hostnames resolve correctly and have verified HTTPS.
- Public pages, services, images, coverage, contacts and inquiry receipt work.
- Admin username `user` initializes from a private secret, forces password
  replacement, and cannot reuse its temporary password.
- Unauthenticated or temporary-password sessions cannot access any dashboard API.
- Logout, expiry, CSRF rejection, progressive lockouts and role checks work.
- A content save appears on the public site after refresh; stale saves return 409.
- A JPEG/PNG/WebP upload survives a process restart and release symlink swap.
- Corporate data/export and uploads are protected; rollback is rehearsed.
- Initial bootstrap secret has been removed; no real secrets in the release.

**Remaining manual prerequisites:** authorized SSH access, confirmed server IP and
capacity, conflict-free port/hostnames/directories, fresh DB/role, private bootstrap
secret and final password, owner-verified business content, DNS, HTTPS issuance,
operator-reviewed Nginx reload and corporate systemd startup. No deployment is complete until
these are performed and verified by an authorized operator.
