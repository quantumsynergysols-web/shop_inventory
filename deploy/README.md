# Putting Shop Inventory ERP on a Hostinger VPS

This guide takes you from an empty VPS to `https://your-domain` with daily backups. You type
the commands yourself; each block is copy-paste. Lines starting with `#` are comments.

What ends up on the server:

| What | Where |
|---|---|
| App releases (one folder per deploy, last 3 kept) | `/opt/erp/releases/…`, live one at `/opt/erp/current` |
| Settings and secrets (only readable by `erp`) | `/etc/erp/erp.env` |
| Bill photos | `/var/lib/erp/storage` |
| Daily database backups (newest 14) | `/var/lib/erp/backups` |
| Deploy and off-site scripts | `/opt/erp/bin/` |
| App service / web server | `erp` (systemd), Caddy (HTTPS, port 80/443) |
| Database | PostgreSQL 16 on the same server, database `shop_erp`, role `erp_app` |

The app itself listens only behind Caddy on port 3000; the firewall allows only SSH, 80 and 443.

---

## 1. Prepare the VPS (Hostinger hPanel)

1. Buy a VPS plan (KVM 1 with 4 GB RAM is enough to start; KVM 2 if many shops will use it).
2. In hPanel → **VPS** → your server → **OS & Panel / Operating system**, choose
   **Ubuntu 24.04 LTS** (plain OS, no control panel).
3. Add your SSH key: hPanel → VPS → **Settings → SSH keys** → *Add SSH key*.
   No key yet? On your Windows PC open PowerShell and run `ssh-keygen -t ed25519`, press Enter
   for every question, then paste the contents of `C:\Users\<you>\.ssh\id_ed25519.pub`.
4. Note the server's **IPv4 address** from the VPS overview page.
5. If you turned on Hostinger's own **VPS firewall** in hPanel, allow TCP 22, 80, 443 there too.

## 2. Point the domain at the VPS

At the company where the domain is registered (Hostinger: hPanel → **Domains → DNS / Nameservers**):

- Add an **A record**: name `erp` (for `erp.yourshop.pk`, or `@` for the bare domain),
  value = the VPS IPv4 address, TTL 300 or lower.
- If there is an **AAAA** record for the same name that does not point to this VPS, delete it
  (Let's Encrypt would try that address and fail).

Check from your PC (wait a few minutes after saving): `nslookup erp.yourshop.pk` must show the VPS IP.
HTTPS only works once this is right.

## 3. Run the setup script

The `deploy/` folder must be committed and pushed to the repository first.

```bash
# from your PC
ssh root@YOUR_VPS_IP

# on the server
apt-get update && apt-get install -y git
git clone https://github.com/quantumsynergysols-web/shop_inventory.git /root/shop_inventory
bash /root/shop_inventory/deploy/setup-server.sh erp.yourshop.pk https://github.com/quantumsynergysols-web/shop_inventory.git you@example.com
```

Arguments: domain, git repository URL, e-mail for Let's Encrypt notices (optional). Without
arguments it asks. It takes 5–10 minutes and can be run again safely. It installs PostgreSQL,
Node.js 22, Caddy, git, rclone and the firewall, creates the `erp` user, the database
role `erp_app` (not a superuser and without BYPASSRLS, because those would skip the
row-level security that keeps shops apart), the database `shop_erp`, the folders above, and
`/etc/erp/erp.env` with a generated database password and `JWT_SECRET` (never shown on screen).

If the repository is ever made private, add a read-only *deploy key* for the `erp` user on
GitHub and use the `git@github.com:…` URL instead.

## 4. Check the settings file

```bash
nano /etc/erp/erp.env
```

Every setting is explained in the file (template: `deploy/env.production.example`). The
generated values are ready to use; usually nothing needs to change. Rules: one `KEY="value"`
per line, no `$`, `#` or `"` inside values. Save with Ctrl+O, Enter, exit with Ctrl+X.

To make a new JWT secret yourself: `openssl rand -base64 48` (changing it signs everybody out).

## 5. First deploy

```bash
sudo -u erp /opt/erp/bin/deploy.sh
```

It downloads the code, runs `npm ci` and `npm run build:all`, makes a database backup,
applies the database migrations (`prisma migrate deploy`), switches `/opt/erp/current` to the
new build, restarts the `erp` service and waits until `/api/health` answers. It ends with
`==> Deployed <commit>`, or stops with `DEPLOY FAILED: …` and leaves the running version alone.

## 6. Create the first shop and owner

The seed command (`apps/api/src/seed.ts`) creates one shop with its owner, the preset categories
and expense heads and the "Walk-in" customer. It only works on an empty database; if a shop
exists it does nothing.

1. Open the settings file and fill in the `SEED_*` lines at the bottom (remove the `#`):

   ```bash
   nano /etc/erp/erp.env
   ```
   ```
   SEED_SHOP_NAME="Al-Madina Sanitary Store"
   SEED_OWNER_NAME="Owner name"
   SEED_OWNER_PHONE="03001234567"
   SEED_OWNER_PASSWORD="a-long-password-you-choose"
   ```
   The phone number is the owner's login. Defaults if a line is left out: shop "Demo Shop",
   name "Owner", phone `03000000001`. **Always set `SEED_OWNER_PASSWORD`**: without it the seed
   makes a random password and writes it into `/opt/erp/current/apps/api/.env`.

2. Run the seed:

   ```bash
   cd /opt/erp/current/apps/api && sudo -u erp node --env-file=/etc/erp/erp.env dist/seed.js
   ```
   It prints `Seeded shop "…" with owner login 03001234567.`

3. Delete the `SEED_OWNER_PASSWORD` line from `/etc/erp/erp.env` again (it is not needed after
   this) and log in at `https://erp.yourshop.pk` with the phone number and password.

## 7. Check that it works

- `https://erp.yourshop.pk/api/health` shows `{"status":"ok","db":"up"}`.
- `https://erp.yourshop.pk` shows the login screen with a padlock in the address bar
  (`http://` redirects to `https://` automatically).
- On the server: `systemctl status erp caddy` shows both `active (running)`.
- In the app: More → **Data safety** shows the last backup (the first one runs about a minute
  after the first start).

## 8. Updating to a new version

Push the new version to the `main` branch, then on the server:

```bash
sudo -u erp /opt/erp/bin/deploy.sh             # newest commit on main
sudo -u erp /opt/erp/bin/deploy.sh v1.2.0      # or a specific tag/commit
```

The old version keeps running while the new one builds; users see only the few seconds of the
restart. A backup is taken before migrations every time (`SKIP_BACKUP=1` skips it).

Back to the previous version (no rebuild): `sudo -u erp /opt/erp/bin/deploy.sh --rollback`.
Migrations are not undone by a rollback; if the new version changed the database, restore the
backup taken just before it (section 9).

If `deploy/erp.service`, `deploy/Caddyfile` or `deploy/setup-server.sh` changed in the new
version, run the setup again from the new release (it keeps your settings file):
`bash /opt/erp/current/deploy/setup-server.sh erp.yourshop.pk <repo-url> [email]`.

## 9. Backups and restore

The app makes a `pg_dump` backup every day at 02:00 Pakistan time (`BACKUP_HOUR`) into
`/var/lib/erp/backups`, keeps the newest 14 (`BACKUP_KEEP`), and catches up a minute after
start if the newest is more than a day old. Files look like `shop_erp-20261118-210000.dump`.

```bash
ls -lh /var/lib/erp/backups                                   # list backups
cd /opt/erp/current/apps/api && sudo -u erp node --env-file=/etc/erp/erp.env dist/backup-cli.js   # one now
```

Bill photos are **not** in the database backup; they are files in `/var/lib/erp/storage`
(see section 10). Owners can also download everything of their shop as a zip from
More → Data safety (Excel + photos).

**Restore** (replaces the whole database with the backup; everything after it is lost):

```bash
sudo systemctl stop erp
sudo -u erp bash -c 'set -a; . /etc/erp/erp.env; pg_restore --clean --if-exists --no-owner -d "${DATABASE_URL%%\?*}" "$0"' /var/lib/erp/backups/shop_erp-YYYYMMDD-HHMMSS.dump
sudo systemctl start erp
```

(`${DATABASE_URL%%\?*}` drops the `?schema=public` part, which `pg_restore` does not accept.)
If the backup is older than the running version's database changes, run
`sudo -u erp /opt/erp/bin/deploy.sh` afterwards to apply the newer migrations.
To restore on a new server: run sections 3–5, copy the `.dump` file to `/var/lib/erp/backups`
(`chown erp:erp` it), restore as above, and copy the photos back into `/var/lib/erp/storage`.

## 10. Off-site copy (strongly recommended)

The backups above sit on the same server as the database; if the VPS is lost, so are they.
`/opt/erp/bin/backup-offsite.sh` copies the newest backups and all bill photos to a cloud
bucket with rclone every night. It only copies, never deletes at the destination.

1. Make a bucket, e.g. Cloudflare R2 (dashboard → R2 → *Create bucket* `shop-erp-backups`, then
   *Manage API tokens* → *Object Read & Write* for that bucket; note Access Key ID, Secret and
   the account endpoint `https://<account-id>.r2.cloudflarestorage.com`) or Backblaze B2
   (bucket + application key with access to that bucket only).
2. Create an rclone remote called `offsite` for the `erp` user:
   ```bash
   sudo -u erp rclone config
   # n (new remote) → name: offsite
   # R2: storage "s3", provider "Cloudflare", enter the key, secret and endpoint
   # B2: storage "b2", enter the key ID and application key
   ```
   For an R2 token limited to one bucket, add the line `no_check_bucket = true` to the
   `[offsite]` section of `/opt/erp/.config/rclone/rclone.conf`.
3. Using another remote name or bucket? Create `/etc/erp/offsite.conf` with
   `OFFSITE_REMOTE="myremote:my-bucket/shop-erp"`.
4. Test once, then switch on the daily timer (03:30 Pakistan time):
   ```bash
   sudo -u erp /opt/erp/bin/backup-offsite.sh
   sudo systemctl enable --now erp-offsite.timer
   systemctl list-timers erp-offsite.timer          # shows the next run
   journalctl -u erp-offsite -n 50                  # result of the last runs
   ```
   Prefer cron? `sudo crontab -u erp -e` and add `30 22 * * * /opt/erp/bin/backup-offsite.sh`
   (22:30 UTC = 03:30 Pakistan time).
5. Set a lifecycle rule on the bucket (e.g. delete objects older than 90 days under
   `backups/`) to keep the bill small. Keep photos.

## 11. Logs

```bash
journalctl -u erp -f                 # app log, live (Ctrl+C to stop)
journalctl -u erp -n 200 --no-pager  # last 200 lines
journalctl -u erp --since "1 hour ago"
journalctl -u caddy -n 100           # HTTPS certificates and web requests
systemctl status erp                 # running? since when?
```

## 12. Troubleshooting

| Problem | What to do |
|---|---|
| Browser shows **502** | The app is not running. `systemctl status erp`, then `journalctl -u erp -n 100`. |
| Log says `Invalid configuration (see apps/api/.env.example): …` | A value in `/etc/erp/erp.env` is wrong (e.g. `JWT_SECRET` shorter than 32 characters). Fix it, `sudo systemctl restart erp`. |
| No padlock / certificate error | DNS not pointing at the VPS yet, an old AAAA record, or port 80/443 blocked (hPanel firewall). `journalctl -u caddy -n 100` says why; Caddy retries by itself. |
| Deploy stops during `npm ci` or build with "Killed" | Out of memory. Check `free -h` shows swap (setup adds 2 GB); stop other programs or use a bigger plan. |
| Deploy fails at `prisma migrate deploy` | The message names the migration. Do not edit the database by hand; restore the backup taken just before (section 9) and report the error. |
| Deploy says "no healthy answer from /api/health" | The new version starts but cannot reach the database or crashes. Read the log; go back with `--rollback`. |
| Upload of bill photos fails with **413** | More than 10 photos or over 15 MB each. Caddy allows 160 MB per upload request. |
| "Data safety" shows a backup error | `journalctl -u erp -g backup`; usually disk full (`df -h`). |
| Disk full | `du -sh /var/lib/erp/* /opt/erp/releases/*`; lower `BACKUP_KEEP`, make sure the off-site copy works. |
| Forgot the server password | You log in with the SSH key; Hostinger hPanel also has a browser terminal and a root password reset. |

Optional security step once your SSH key login works: in `/etc/ssh/sshd_config` set
`PasswordAuthentication no`, then `systemctl reload ssh`. Keep the hPanel browser terminal as a
fallback. Ubuntu installs security updates automatically (`unattended-upgrades`).

**Ubuntu 22.04 instead of 24.04:** the scripts also work there; it comes with PostgreSQL 14
instead of 16, which is fine for this app.
