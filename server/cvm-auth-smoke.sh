#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/dandan-world-server-20260823192735}"
cd "$APP_DIR"
API_BASE="${API_BASE:-http://127.0.0.1:3310}"
HEALTH_URL="${HEALTH_URL:-${API_BASE}/health}"
STAMP=$(date +%s)
EMAIL="smoke-${STAMP}@example.com"
NICK="smoke-${STAMP}"
COOKIE_FILE=/tmp/dandan-auth-smoke.cookies
trap 'MYSQL_PWD="${MYSQL_PWD:-}" mysql -h127.0.0.1 -uapp_user dandan_world -Nse "DELETE FROM users WHERE email=\"${EMAIL}\";" >/dev/null 2>&1 || true; rm -f "$COOKIE_FILE"' EXIT

export MYSQL_PWD="$(python3 - <<'PY'
from pathlib import Path
from urllib.parse import unquote, urlsplit

raw = next((line.split('=', 1)[1].strip() for line in Path('.env').read_text().splitlines()
            if line.startswith('DATABASE_URL=')), '')
url = raw.strip('"')
parsed = urlsplit(url)
if parsed.scheme != 'mysql' or parsed.hostname != '127.0.0.1' or parsed.port != 3306 \
        or parsed.username != 'app_user' or parsed.path != '/dandan_world' or parsed.password is None:
    raise SystemExit('DATABASE_URL must contain app_user, password, 127.0.0.1:3306 and dandan_world')
print(unquote(parsed.password), end='')
PY
)"

curl -fsS "$HEALTH_URL" >/dev/null

curl -fsS -X POST "${API_BASE}/api/auth/verification-codes" \
  -H 'content-type: application/json' \
  -d "{\"channel\":\"email\",\"target\":\"${EMAIL}\",\"purpose\":\"register\"}" >/tmp/dandan-code.json

mysql -h127.0.0.1 -uapp_user dandan_world -Nse \
  "UPDATE verification_codes SET code_hash=SHA2('123456',256) WHERE target='${EMAIL}' AND purpose='register';"

TOKEN=$(curl -fsS -X POST "${API_BASE}/api/auth/verification-codes/verify" \
  -H 'content-type: application/json' \
  -d "{\"channel\":\"email\",\"target\":\"${EMAIL}\",\"purpose\":\"register\",\"code\":\"123456\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["verificationToken"])')

REGISTER=$(curl -fsS -c "$COOKIE_FILE" -X POST "${API_BASE}/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"nickname\":\"${NICK}\",\"email\":\"${EMAIL}\",\"password\":\"SmokePass123!\",\"verificationToken\":\"${TOKEN}\",\"eggCategory\":\"study\"}")
ACCESS_TOKEN=$(python3 - "$REGISTER" <<'PY'
import json, sys
print(json.loads(sys.argv[1])['accessToken'])
PY
)

REFRESH=$(curl -fsS -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X POST "${API_BASE}/api/auth/refresh" \
  -H 'content-type: application/json' -d '{}')
ACCESS_TOKEN=$(python3 - "$REFRESH" <<'PY'
import json, sys
print(json.loads(sys.argv[1])['accessToken'])
PY
)
ME=$(curl -fsS -b "$COOKIE_FILE" -H "authorization: Bearer ${ACCESS_TOKEN}" "${API_BASE}/api/users/me")
LOGOUT=$(curl -fsS -b "$COOKIE_FILE" -H "authorization: Bearer ${ACCESS_TOKEN}" -X POST "${API_BASE}/api/auth/logout")

RESET_REQUEST=$(curl -fsS -X POST "${API_BASE}/api/auth/password-reset/request" \
  -H 'content-type: application/json' \
  -d "{\"channel\":\"email\",\"target\":\"${EMAIL}\"}")
mysql -h127.0.0.1 -uapp_user dandan_world -Nse \
  "UPDATE verification_codes SET code_hash=SHA2('654321',256) WHERE target='${EMAIL}' AND purpose='reset_password';"

RESET_TOKEN=$(curl -fsS -X POST "${API_BASE}/api/auth/verification-codes/verify" \
  -H 'content-type: application/json' \
  -d "{\"channel\":\"email\",\"target\":\"${EMAIL}\",\"purpose\":\"reset_password\",\"code\":\"654321\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["verificationToken"])')

RESET=$(curl -fsS -X POST "${API_BASE}/api/auth/password-reset/confirm" \
  -H 'content-type: application/json' \
  -d "{\"channel\":\"email\",\"target\":\"${EMAIL}\",\"verificationToken\":\"${RESET_TOKEN}\",\"newPassword\":\"SmokePass456!\"}")

OLD_SESSION_STATUS=$(curl -sS -o /tmp/dandan-old-session.json -w '%{http_code}' \
  -H "authorization: Bearer ${ACCESS_TOKEN}" "${API_BASE}/api/users/me")
LOGIN=$(curl -fsS -X POST "${API_BASE}/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"identifier\":\"${EMAIL}\",\"password\":\"SmokePass456!\"}")

python3 - "$REGISTER" "$REFRESH" "$ME" "$LOGOUT" "$RESET_REQUEST" "$RESET" "$LOGIN" "$OLD_SESSION_STATUS" <<'PY'
import json, sys
register, refresh, me, logout, reset_request, reset, login, old_session_status = [json.loads(value) if i < 7 else value for i, value in enumerate(sys.argv[1:])]
assert register['user']['nickname'].startswith('smoke-')
assert 'accessToken' in register and 'refreshToken' not in register
assert 'accessToken' in refresh and 'refreshToken' not in refresh
assert me['user']['nickname'].startswith('smoke-')
assert logout['ok'] is True
assert reset_request['ok'] is True
assert reset['ok'] is True
assert old_session_status == '401'
assert login['user']['nickname'].startswith('smoke-')
print('AUTH_SMOKE_OK')
PY
