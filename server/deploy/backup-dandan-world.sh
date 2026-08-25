#!/usr/bin/env bash
set -Eeuo pipefail

# Run from the server project directory. The .env file is never printed.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
umask 077

if [[ ! -f .env ]]; then
  echo "missing $ROOT_DIR/.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/dandan_world}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

export BACKUP_DIR STAMP
python3 - "$BACKUP_DIR" "$STAMP" <<'PY'
import sys
from urllib.parse import unquote, urlparse
from pathlib import Path
import subprocess
import os

url = os.environ["DATABASE_URL"]
backup_dir, stamp = sys.argv[1:]
parsed = urlparse(url)
if parsed.scheme not in {"mysql", "mariadb"} or not parsed.hostname or not parsed.path:
    raise SystemExit("DATABASE_URL must be a mysql:// or mariadb:// URL")

output = Path(backup_dir) / f"dandan_world-{stamp}.sql.gz"
args = [
    "mysqldump", "--single-transaction", "--routines", "--events",
    "--hex-blob", "--no-tablespaces", "--protocol=tcp",
    "--host", parsed.hostname,
    "--port", str(parsed.port or 3306),
    "--user", unquote(parsed.username or ""),
    parsed.path.lstrip("/"),
]
password = unquote(parsed.password or "")
proc = subprocess.Popen(args, env={**os.environ, "MYSQL_PWD": password}, stdout=subprocess.PIPE)
with output.open("wb") as dst:
    compressor = subprocess.Popen(["gzip", "-9"], stdin=proc.stdout, stdout=dst)
    proc.stdout.close()
    if compressor.wait() != 0 or proc.wait() != 0:
        output.unlink(missing_ok=True)
        raise SystemExit("mysqldump failed")
print(output)
PY

find "$BACKUP_DIR" -type f -name 'dandan_world-*.sql.gz' -mtime +14 -delete
echo "backup complete"
