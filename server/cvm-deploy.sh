#!/usr/bin/env bash
set -euo pipefail

# Run on the CVM from the deployed application directory.
APP_DIR="${APP_DIR:-/root/dandan-world-server-20260823192735}"
PORT="${PORT:-3310}"

cd "$APP_DIR"

test -f .env || { echo "missing $APP_DIR/.env" >&2; exit 1; }
grep -q '^DATABASE_URL=' .env || { echo "DATABASE_URL is not configured" >&2; exit 1; }
grep -q '^JWT_SECRET=' .env || { echo "JWT_SECRET is not configured" >&2; exit 1; }

echo "[1/4] Installing locked dependencies"
npm ci

echo "[2/4] Generating Prisma client"
npx prisma generate

echo "[3/4] Applying database migrations"
npx prisma migrate deploy

echo "[4/4] Building application"
npm run build

echo "CVM_BUILD_READY; restart the service, then check http://127.0.0.1:${PORT}/health"
