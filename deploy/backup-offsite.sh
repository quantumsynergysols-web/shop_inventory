#!/usr/bin/env bash
# Optional: copies the newest database backups and all bill photos to off-site storage with
# rclone (Cloudflare R2, Backblaze B2, ...). Runs as erp, daily, from erp-offsite.timer.
#
#   sudo -u erp /opt/erp/bin/backup-offsite.sh         # run once by hand
#
# One-time setup (deploy/README.md, "Off-site copy"): create a bucket, then
#   sudo -u erp rclone config            # make a remote named "offsite"
# and set OFFSITE_REMOTE in /etc/erp/offsite.conf if you use another name or bucket.
#
# Only copies (rclone copy): nothing is ever deleted at the remote, so a mistake or an
# attack on this server cannot wipe the off-site copy. Set a lifecycle rule on the bucket
# to expire old backups if storage cost matters.
set -euo pipefail

ENV_FILE=/etc/erp/erp.env
OFFSITE_REMOTE="offsite:shop-erp-backups"   # rclone remote:bucket[/folder]
DUMP_MAX_AGE="3d"                           # backups newer than this are copied
[[ -r /etc/erp/offsite.conf ]] && . /etc/erp/offsite.conf
export HOME=/opt/erp
export RCLONE_CONFIG=${RCLONE_CONFIG:-/opt/erp/.config/rclone/rclone.conf}

value() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" "$ENV_FILE" | head -n1; }
BACKUP_DIR=$(value BACKUP_DIR)
STORAGE_DIR=$(value STORAGE_DIR)
BACKUP_DIR=${BACKUP_DIR:-/var/lib/erp/backups}
STORAGE_DIR=${STORAGE_DIR:-/var/lib/erp/storage}

command -v rclone >/dev/null || { echo "rclone is not installed (sudo apt install rclone)" >&2; exit 1; }
[[ -f $RCLONE_CONFIG ]] || { echo "no rclone config at $RCLONE_CONFIG (sudo -u erp rclone config)" >&2; exit 1; }
[[ -d $BACKUP_DIR ]] || { echo "backup folder $BACKUP_DIR not found" >&2; exit 1; }

newest=$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -printf '%T@ %f\n' | sort -nr | head -n1 | cut -d' ' -f2-)
[[ -n $newest ]] || { echo "no *.dump files in $BACKUP_DIR yet" >&2; exit 1; }
age_h=$(( ($(date +%s) - $(stat -c %Y "$BACKUP_DIR/$newest")) / 3600 ))
echo "newest backup: $newest (${age_h}h old)"
if (( age_h > 36 )); then
  echo "WARNING: the newest backup is more than 36 hours old; check the app's backup (More > Data safety)" >&2
fi

echo "copying database backups to $OFFSITE_REMOTE/backups"
rclone copy "$BACKUP_DIR" "$OFFSITE_REMOTE/backups" --include '*.dump' --max-age "$DUMP_MAX_AGE" --stats-one-line --stats 0

if [[ -d $STORAGE_DIR ]]; then
  echo "copying bill photos to $OFFSITE_REMOTE/photos"
  rclone copy "$STORAGE_DIR" "$OFFSITE_REMOTE/photos" --stats-one-line --stats 0
fi

# Fail when the off-site copy of the newest backup is missing
rclone lsf "$OFFSITE_REMOTE/backups" --include "$newest" | grep -qx "$newest" \
  || { echo "ERROR: $newest is not at $OFFSITE_REMOTE/backups after the copy" >&2; exit 1; }
echo "off-site copy OK"
