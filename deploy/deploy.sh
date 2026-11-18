#!/usr/bin/env bash
# Builds and starts a new version of the Shop Inventory ERP. Run as the erp user:
#
#   sudo -u erp /opt/erp/bin/deploy.sh            # newest commit of BRANCH (deploy.conf)
#   sudo -u erp /opt/erp/bin/deploy.sh <commit>   # a specific commit or tag
#   sudo -u erp /opt/erp/bin/deploy.sh --rollback # back to the previous release (no rebuild)
#
# Steps: fetch the repo, unpack the commit into a new folder under /opt/erp/releases, npm ci,
# npm run build:all, database backup, prisma migrate
# deploy, point /opt/erp/current at the new folder, restart the service and wait for
# /api/health. The running version keeps serving until the restart, and a failed build leaves
# it untouched. Stops at the first error.
set -euo pipefail

APP_HOME=/opt/erp
REPO_DIR=$APP_HOME/repo
RELEASES=$APP_HOME/releases
CURRENT=$APP_HOME/current
ENV_FILE=/etc/erp/erp.env
KEEP_RELEASES=3
HEALTH_TIMEOUT=90

log() { printf '\n==> %s\n' "$*"; }
die() {
  printf '\nDEPLOY FAILED: %s\n' "$*" >&2
  printf 'Logs: sudo journalctl -u erp -n 100 --no-pager\n' >&2
  printf 'If the site is down after "Switching": sudo -u erp /opt/erp/bin/deploy.sh --rollback\n' >&2
  exit 1
}
trap 'die "command failed on line $LINENO"' ERR

[[ $(id -un) == erp ]] || { echo "run as erp: sudo -u erp $0 $*" >&2; exit 1; }
[[ -r /etc/erp/deploy.conf ]] || die "/etc/erp/deploy.conf missing (run setup-server.sh first)"
# shellcheck source=/dev/null
. /etc/erp/deploy.conf
[[ -n ${REPO_URL:-} ]] || die "REPO_URL not set in /etc/erp/deploy.conf"
BRANCH=${BRANCH:-main}
[[ -r $ENV_FILE ]] || die "$ENV_FILE missing or not readable by erp"
if grep -E '^(DATABASE_URL|JWT_SECRET)=' "$ENV_FILE" | grep -q CHANGE_ME; then
  die "$ENV_FILE still has CHANGE_ME in DATABASE_URL or JWT_SECRET"
fi
PORT=$(sed -n 's/^PORT="\{0,1\}\([0-9]*\)"\{0,1\}.*/\1/p' "$ENV_FILE" | head -n1)
PORT=${PORT:-3000}
export HOME=$APP_HOME
cd "$APP_HOME"
umask 027
# npm must install devDependencies (TypeScript, Prisma CLI, Vite) to build
unset NODE_ENV

restart_and_wait() {
  log "Restarting the service"
  sudo -n /usr/bin/systemctl restart erp
  local i body=
  for ((i = 0; i < HEALTH_TIMEOUT; i += 2)); do
    body=$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
    if [[ $body == *'"status":"ok"'* ]]; then
      echo "healthy: $body"
      return 0
    fi
    sleep 2
  done
  die "no healthy answer from http://127.0.0.1:$PORT/api/health within ${HEALTH_TIMEOUT}s (last: ${body:-none})"
}

# Finished releases carry a .deployed marker; anything else is a failed or interrupted build.
releases() { find "$RELEASES" -mindepth 2 -maxdepth 2 -name .deployed -printf '%h\n' | xargs -r -n1 basename | sort; }

if [[ ${1:-} == --rollback ]]; then
  [[ -L $CURRENT ]] || die "no current release"
  now=$(basename "$(readlink -f "$CURRENT")")
  prev=$(releases | grep -B1 -x "$now" | head -n1 || true)
  [[ -n $prev && $prev != "$now" ]] || die "no older release to go back to"
  echo "WARNING: database migrations are not undone. If the newer release changed the database,"
  echo "restore the backup taken before it instead (deploy/README.md, Restore)."
  ln -sfn "$RELEASES/$prev" "$CURRENT.tmp" && mv -T "$CURRENT.tmp" "$CURRENT"
  restart_and_wait
  log "Rolled back from $now to $prev"
  exit 0
fi

log "Fetching $REPO_URL ($BRANCH)"
if [[ ! -d $REPO_DIR/.git ]]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
else
  git -C "$REPO_DIR" remote set-url origin "$REPO_URL"
  git -C "$REPO_DIR" fetch --prune --tags origin
fi
REF=${1:-origin/$BRANCH}
COMMIT=$(git -C "$REPO_DIR" rev-parse --verify --quiet "$REF^{commit}") || die "unknown commit $REF"
SHORT=${COMMIT:0:10}
echo "commit $SHORT: $(git -C "$REPO_DIR" log -1 --format='%s (%cd)' --date=short "$COMMIT")"

# Remove builds that never finished
live=$(readlink -f "$CURRENT" 2>/dev/null || true)
for d in "$RELEASES"/*/; do
  d=${d%/}
  if [[ -d $d && ! -e $d/.deployed && $d != "$live" ]]; then rm -rf "${d:?}"; fi
done

# Built in its final folder (Prisma's generated client remembers where it was generated)
REL_NAME="$(date -u +%Y%m%d-%H%M%S)-$SHORT"
REL=$RELEASES/$REL_NAME
log "Unpacking into $REL"
mkdir -p "$REL"
git -C "$REPO_DIR" archive "$COMMIT" | tar -x -C "$REL"
[[ -f $REL/package-lock.json ]] || die "package-lock.json missing at the repository root (npm ci needs it)"

log "npm ci"
(cd "$REL" && npm ci --include=dev --no-audit --no-fund)

log "npm run build:all"
(cd "$REL" && npm run build:all)
[[ -f $REL/apps/api/dist/main.js ]] || die "build did not produce apps/api/dist/main.js"
[[ -f $REL/apps/web/dist/index.html ]] || die "build did not produce apps/web/dist/index.html"

if [[ ${SKIP_BACKUP:-0} != 1 ]]; then
  log "Database backup before migrating (set SKIP_BACKUP=1 to skip)"
  (cd "$REL/apps/api" && node --env-file="$ENV_FILE" dist/backup-cli.js)
fi

log "prisma migrate deploy"
(cd "$REL/apps/api" && node --env-file="$ENV_FILE" ../../node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma)

log "Switching $CURRENT to $REL_NAME"
touch "$REL/.deployed"
ln -sfn "$REL" "$CURRENT.tmp"
mv -T "$CURRENT.tmp" "$CURRENT"

restart_and_wait

log "Removing old releases (keeping $KEEP_RELEASES)"
mapfile -t old < <(releases | head -n -"$KEEP_RELEASES")
for r in "${old[@]}"; do
  [[ $RELEASES/$r == "$(readlink -f "$CURRENT")" ]] || rm -rf "${RELEASES:?}/$r"
done

# Newer helper scripts from this release (rename, so a running copy is not changed under it)
for s in deploy.sh backup-offsite.sh; do
  if [[ -f $REL/deploy/$s ]]; then
    cp "$REL/deploy/$s" "$APP_HOME/bin/.$s.new" && chmod 755 "$APP_HOME/bin/.$s.new" && mv "$APP_HOME/bin/.$s.new" "$APP_HOME/bin/$s"
  fi
done

log "Deployed $SHORT"
