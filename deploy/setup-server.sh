#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 LTS server for the Shop Inventory ERP. Run as root:
#
#   bash deploy/setup-server.sh <domain> <git-repo-url> [letsencrypt-email]
#   e.g. bash deploy/setup-server.sh erp.myshop.pk https://github.com/owner/shop_inventory.git
#
# Without arguments it asks. Safe to run again (it skips what is already done and never
# replaces an existing /etc/erp/erp.env). It does NOT build or start the app: run
# /opt/erp/bin/deploy.sh afterwards (see deploy/README.md).
#
# What it does: apt upgrade, swap (if none), user "erp", PostgreSQL (Ubuntu package),
# Node.js 22 (NodeSource repo), git, Caddy (Caddy repo), rclone, ufw (SSH, 80, 443 only),
# database role erp_app (no superuser, NOBYPASSRLS) owning database shop_erp, directories,
# /etc/erp/erp.env with a generated database password and JWT secret (never printed),
# the erp systemd unit and the Caddyfile.
set -euo pipefail

DB_NAME=shop_erp
DB_ROLE=erp_app
APP_USER=erp
APP_HOME=/opt/erp
DATA_DIR=/var/lib/erp
CONF_DIR=/etc/erp
ENV_FILE=$CONF_DIR/erp.env
NODE_MAJOR=22
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd /   # so "runuser -u postgres" does not complain about /root

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[[ $(id -u) -eq 0 ]] || die "run as root (sudo bash $0 ...)"
[[ -r /etc/os-release ]] && . /etc/os-release
[[ ${ID:-} == ubuntu ]] || die "this script is written for Ubuntu (found ${ID:-unknown})"
[[ ${VERSION_ID:-} == 24.04 ]] || echo "WARNING: written for Ubuntu 24.04, found ${VERSION_ID:-?}; continuing"
for f in env.production.example erp.service Caddyfile deploy.sh backup-offsite.sh erp-offsite.service erp-offsite.timer; do
  [[ -f $SCRIPT_DIR/$f ]] || die "missing $SCRIPT_DIR/$f (run this from a copy of the repository)"
done

DOMAIN=${1:-}
REPO_URL=${2:-}
ACME_EMAIL=${3:-}
[[ -n $DOMAIN ]] || read -rp "Domain for the app (e.g. erp.myshop.pk): " DOMAIN
[[ -n $REPO_URL ]] || read -rp "Git repository URL (https://...): " REPO_URL
if [[ -z $ACME_EMAIL && -t 0 && -z ${1:-} ]]; then
  read -rp "E-mail for Let's Encrypt notices (optional, Enter to skip): " ACME_EMAIL
fi
[[ $DOMAIN =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]] || die "not a domain name: $DOMAIN"
[[ $REPO_URL =~ ^[A-Za-z0-9@:/._~+-]+$ ]] || die "git repository URL is required (no spaces or quotes): $REPO_URL"
[[ -z $ACME_EMAIL || $ACME_EMAIL =~ ^[^@[:space:]]+@[^@[:space:]]+$ ]] || die "not an e-mail address: $ACME_EMAIL"

export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
APT_OPTS=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

log "Updating Ubuntu packages"
apt-get update
apt-get "${APT_OPTS[@]}" upgrade
apt-get "${APT_OPTS[@]}" install ca-certificates curl gnupg git ufw openssl rclone \
  debian-keyring debian-archive-keyring apt-transport-https

log "Swap (npm builds need memory on small plans)"
if [[ -z $(swapon --show --noheadings) ]]; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "swap already present"
fi

log "Node.js $NODE_MAJOR from NodeSource"
install -d -m 0755 /etc/apt/keyrings
if [[ ! -s /etc/apt/keyrings/nodesource.gpg ]]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
fi
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
# Prefer NodeSource's nodejs over Ubuntu's older one
printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' > /etc/apt/preferences.d/nodesource

log "Caddy from Caddy's apt repository"
if [[ ! -s /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]]; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
fi
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list

apt-get update
apt-get "${APT_OPTS[@]}" install nodejs caddy postgresql

node_version=$(node -v)
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || die "Node $node_version is older than 22.18 (root package.json engines)"
echo "node $node_version, npm $(npm -v), $(psql --version), $(caddy version | cut -d' ' -f1)"

log "Firewall: OpenSSH, 80, 443 only"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443          # tcp for HTTPS, udp for HTTP/3
ufw --force enable
ufw status verbose

log "User $APP_USER and directories"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$APP_HOME" --create-home --shell /usr/sbin/nologin "$APP_USER"
fi
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$APP_HOME" "$APP_HOME/releases" "$APP_HOME/bin"
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR" "$DATA_DIR/storage" "$DATA_DIR/backups"
install -d -m 0750 -o root -g "$APP_USER" "$CONF_DIR"

log "PostgreSQL role $DB_ROLE and database $DB_NAME"
systemctl enable --now postgresql
# Keep the password that is already in erp.env (re-runs); otherwise make a new one.
DB_PASSWORD=
if [[ -f $ENV_FILE ]]; then
  DB_PASSWORD=$(sed -n 's|^DATABASE_URL="\{0,1\}postgresql://[^:]*:\([^@]*\)@.*|\1|p' "$ENV_FILE" | head -n1)
fi
if [[ -z $DB_PASSWORD || $DB_PASSWORD == CHANGE_ME* ]]; then
  DB_PASSWORD=$(openssl rand -hex 24)
fi
[[ $DB_PASSWORD =~ ^[A-Za-z0-9]+$ ]] || die "the database password in $ENV_FILE must be letters/digits only for this script; fix it or remove the file"
# Statements go through stdin, so the password is never on a command line.
runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d postgres <<SQL
SELECT 'CREATE ROLE $DB_ROLE LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_ROLE')\gexec
-- Superusers and BYPASSRLS roles skip row-level security (NFR-SEC-02), so neither is allowed.
ALTER ROLE $DB_ROLE WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$DB_PASSWORD';
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_ROLE ENCODING ''UTF8'' TEMPLATE template0' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
ALTER DATABASE $DB_NAME OWNER TO $DB_ROLE;
REVOKE ALL ON DATABASE $DB_NAME FROM PUBLIC;
SQL
# Public schema owned by the app role so migrations can create tables there.
runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "ALTER SCHEMA public OWNER TO $DB_ROLE;"
runuser -u postgres -- psql -X -At -d postgres -c \
  "SELECT 'role '||rolname||': superuser='||rolsuper||' bypassrls='||rolbypassrls FROM pg_roles WHERE rolname='$DB_ROLE'"

log "Settings file $ENV_FILE"
if [[ -f $ENV_FILE ]]; then
  echo "$ENV_FILE already exists; left unchanged"
else
  umask 077
  JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
  # Values go through the environment (not argv) into awk; nothing is printed.
  DBURL="postgresql://$DB_ROLE:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME?schema=public" JWT="$JWT_SECRET" \
    awk '/^DATABASE_URL=/ { print "DATABASE_URL=\"" ENVIRON["DBURL"] "\""; next }
         /^JWT_SECRET=/   { print "JWT_SECRET=\"" ENVIRON["JWT"] "\""; next }
         { print }' "$SCRIPT_DIR/env.production.example" > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  umask 022
  unset JWT_SECRET
  echo "created $ENV_FILE (database password and JWT_SECRET generated)"
fi
unset DB_PASSWORD
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

cat > "$CONF_DIR/deploy.conf" <<CONF
# Read by /opt/erp/bin/deploy.sh
REPO_URL="$REPO_URL"
BRANCH="main"
CONF
chmod 644 "$CONF_DIR/deploy.conf"

log "Deploy scripts in $APP_HOME/bin"
install -m 0755 -o "$APP_USER" -g "$APP_USER" "$SCRIPT_DIR/deploy.sh" "$APP_HOME/bin/deploy.sh"
install -m 0755 -o "$APP_USER" -g "$APP_USER" "$SCRIPT_DIR/backup-offsite.sh" "$APP_HOME/bin/backup-offsite.sh"
# deploy.sh (running as erp) may restart the app and nothing else
cat > /etc/sudoers.d/erp-deploy.tmp <<'SUDO'
erp ALL=(root) NOPASSWD: /usr/bin/systemctl restart erp, /usr/bin/systemctl restart erp.service
SUDO
chmod 440 /etc/sudoers.d/erp-deploy.tmp
visudo -cf /etc/sudoers.d/erp-deploy.tmp >/dev/null || die "sudoers rule failed to validate"
mv /etc/sudoers.d/erp-deploy.tmp /etc/sudoers.d/erp-deploy

log "systemd units"
install -m 0644 "$SCRIPT_DIR/erp.service" /etc/systemd/system/erp.service
install -m 0644 "$SCRIPT_DIR/erp-offsite.service" /etc/systemd/system/erp-offsite.service
install -m 0644 "$SCRIPT_DIR/erp-offsite.timer" /etc/systemd/system/erp-offsite.timer
systemctl daemon-reload
systemctl enable erp.service   # starts on boot; deploy.sh starts it the first time

log "Caddy for https://$DOMAIN"
{
  if [[ -n $ACME_EMAIL ]]; then printf '{\n\temail %s\n}\n\n' "$ACME_EMAIL"; fi
  sed "s/^erp\.example\.com {/$DOMAIN {/" "$SCRIPT_DIR/Caddyfile"
} > /etc/caddy/Caddyfile.new
caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile.new
mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload-or-restart caddy

cat <<DONE

Server prepared.
Next (see deploy/README.md):
  1. Check the settings:   sudo nano $ENV_FILE
  2. First deploy:         sudo -u $APP_USER $APP_HOME/bin/deploy.sh
  3. Create shop + owner:  README step "Create the first shop and owner"
  4. Open https://$DOMAIN  (the domain's A record must point to this server)
DONE
