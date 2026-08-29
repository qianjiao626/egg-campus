#!/usr/bin/env bash
set -euo pipefail

# Run on the CVM from the deployed application directory.
APP_DIR="${APP_DIR:-/root/dandan-world-server-20260823192735}"
PORT="${PORT:-3310}"

cd "$APP_DIR"

test -f .env || { echo "missing $APP_DIR/.env" >&2; exit 1; }
grep -q '^DATABASE_URL=' .env || { echo "DATABASE_URL is not configured" >&2; exit 1; }
grep -q '^JWT_SECRET=' .env || { echo "JWT_SECRET is not configured" >&2; exit 1; }

# Fail closed before npm/prisma work: production must use a complete local DB
# URL and keep the app behind the Nginx /dd reverse proxy.
awk '/\\$/ { exit 1 }' .env || { echo "invalid .env: line ends with a backslash" >&2; exit 1; }
DATABASE_URL_VALUE="$(sed -n 's/^DATABASE_URL=//p' .env | sed 's/^"//;s/"$//')"
case "$DATABASE_URL_VALUE" in
  mysql://*:*@*:*/*) ;;
  *) echo "invalid DATABASE_URL: expected mysql://user:password@host:port/database" >&2; exit 1 ;;
esac
grep -Eq '^HOST="?127\.0\.0\.1"?$' .env || { echo "HOST must be 127.0.0.1 in production" >&2; exit 1; }
grep -Eq '^CORS_ORIGIN="?https://dsxnb\.com"?$' .env || { echo "CORS_ORIGIN must be https://dsxnb.com in production" >&2; exit 1; }
grep -Eq '^VERIFICATION_PROVIDER="?disabled"?$' .env || { echo "VERIFICATION_PROVIDER must be disabled while verification delivery is not configured" >&2; exit 1; }

echo "[1/4] Installing locked dependencies"
npm ci

echo "[2/4] Generating Prisma client"
npx prisma generate

echo "[3/4] Applying database migrations"
npx prisma migrate deploy

echo "[4/4] Building application"
npm run build

echo "CVM_BUILD_READY; restart the service, then check http://127.0.0.1:${PORT}/health"
