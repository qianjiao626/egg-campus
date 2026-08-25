#!/usr/bin/env bash
set -Eeuo pipefail
BACKUP_FILE="${1:?usage: verify-backup.sh /path/to/backup.sql.gz}"
[[ -s "$BACKUP_FILE" ]] || { echo "backup missing or empty" >&2; exit 1; }
gzip -t "$BACKUP_FILE"
gzip -cd "$BACKUP_FILE" | head -n 5
echo "backup archive is readable: $BACKUP_FILE"
