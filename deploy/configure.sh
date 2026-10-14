#!/bin/sh
set -eu

cd "$(dirname "$0")"
if [ -e .env ]; then
  echo '.env already exists; edit it to keep your existing secrets.' >&2
  exit 1
fi

command -v openssl >/dev/null
umask 077
set -C
{
  cat <<'EOF'
# Public addresses used in sign-in links and telemetry onboarding.
BETTER_AUTH_URL=http://localhost:3000
EVERR_PUBLIC_INGEST_URL=http://localhost:4318
# Bind locally by default. Use a TLS reverse proxy for remote access.
BIND_ADDRESS=127.0.0.1

# Optional: configure SMTP to deliver invitations and password-reset emails.
# Single-quote values containing a dollar sign. URL-encode SMTP credentials.
EMAIL_DSN=
EMAIL_FROM=

# Supported retention windows: 1, 7, 14, 30, 90, 180, 365 days.
EVERR_RETENTION_DAYS=30

# ClickHouse SQL API uses one fixed restricted user.
CLICKHOUSE_SQL_API_USERNAME=sql_api

# Generated secrets. Keep these with your backups.
EOF
  for key in POSTGRES_PASSWORD CLICKHOUSE_PASSWORD COLLECTOR_RW_PASSWORD APP_RO_PASSWORD WEB_APP_ADMIN_PASSWORD CLICKHOUSE_SQL_API_PASSWORD BETTER_AUTH_SECRET INGEST_VERIFY_SHARED_SECRET; do
    value=$(openssl rand -hex 32)
    printf '%s=%s\n' "$key" "$value"
  done
} > .env

echo 'Created .env. Run docker compose up -d --build --wait.'
