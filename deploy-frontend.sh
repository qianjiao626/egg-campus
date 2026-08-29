#!/bin/bash
set -euo pipefail
STATIC_DIR="${STATIC_DIR:-/var/www/dd}"
BACKUP_ROOT="${BACKUP_ROOT:-/tmp}"
RELEASE_MANIFEST="${RELEASE_MANIFEST:-}"
if [ -z "$RELEASE_MANIFEST" ]; then
  echo "RELEASE_MANIFEST is required; choose an audited version manifest" >&2
  exit 2
fi
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$ROOT_DIR/server/scripts/verify-release-boundary.mjs" --production "$RELEASE_MANIFEST"
BACKUP_NAME="frontend-backup-$(date +%Y%m%d%H%M%S)-$$"
BACKUP_DIR="$BACKUP_ROOT/$BACKUP_NAME"
STAGING_DIR="$(mktemp -d /tmp/dandan-frontend-stage-XXXXXX)"
DEPLOYED_LIST="$STAGING_DIR/.deployed-files"
ACTIVE_TEMP=""
cleanup() {
  rm -rf "$STAGING_DIR"
}
rollback_on_error() {
  status="$1"
  trap - ERR
  set +e
  [ -n "$ACTIVE_TEMP" ] && rm -f "$ACTIVE_TEMP"
  if [ -f "$DEPLOYED_LIST" ]; then
    while IFS= read -r relative_path; do
      [ -n "$relative_path" ] || continue
      if [ -f "$BACKUP_DIR/$relative_path" ]; then
        cp "$BACKUP_DIR/$relative_path" "$STATIC_DIR/$relative_path"
      else
        rm -f "$STATIC_DIR/$relative_path"
      fi
    done < "$DEPLOYED_LIST"
  fi
  echo "Frontend deployment failed; restored files already replaced. Backup at $BACKUP_DIR" >&2
  exit "$status"
}
trap cleanup EXIT
trap 'rollback_on_error $?' ERR
node "$ROOT_DIR/server/scripts/stage-release-frontend.mjs" "$RELEASE_MANIFEST" "$STAGING_DIR"
mkdir -p "$BACKUP_ROOT" "$BACKUP_DIR"
while IFS= read -r -d '' staged_file; do
  relative_path="${staged_file#"$STAGING_DIR"/}"
  if [ -f "$STATIC_DIR/$relative_path" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$relative_path")"
    cp "$STATIC_DIR/$relative_path" "$BACKUP_DIR/$relative_path"
  fi
done < <(find "$STAGING_DIR" -type f ! -name '.deployed-files' -print0 | sort -z)
while IFS= read -r -d '' staged_file; do
  relative_path="${staged_file#"$STAGING_DIR"/}"
  mkdir -p "$STATIC_DIR/$(dirname "$relative_path")"
  ACTIVE_TEMP="$STATIC_DIR/$(dirname "$relative_path")/.dandan-deploy-$$-$(basename "$relative_path")"
  cp "$staged_file" "$ACTIVE_TEMP"
  mv -f "$ACTIVE_TEMP" "$STATIC_DIR/$relative_path"
  ACTIVE_TEMP=""
  printf '%s\n' "$relative_path" >> "$DEPLOYED_LIST"
done < <(find "$STAGING_DIR" -type f ! -name '.deployed-files' -print0 | sort -z)
printf '%s\n' "$BACKUP_NAME" > "$BACKUP_ROOT/.latest"
trap - ERR
echo "Frontend files deployed. Backup at $BACKUP_DIR"
echo "Run: nginx -t && nginx -s reload"

