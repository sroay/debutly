#!/usr/bin/env bash
# Starts a throwaway Twenty at http://localhost:3000 with Mailpit at http://localhost:8025.
set -euo pipefail
cd "$(dirname "$0")"

pg_password=$(openssl rand -hex 16)
cat > app.env <<EOF
SERVER_URL=${PUBLIC_URL:-http://localhost:3000}
PG_DATABASE_URL=postgres://postgres:$pg_password@db:5432/default
POSTGRES_DB=default
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$pg_password
REDIS_URL=redis://redis:6379
ENCRYPTION_KEY=$(openssl rand -hex 32)
APP_SECRET=$(openssl rand -hex 32)
STORAGE_TYPE=local
TELEMETRY_ENABLED=false
ANALYTICS_ENABLED=false
EMAIL_DRIVER=smtp
EMAIL_SMTP_HOST=mailpit
EMAIL_SMTP_PORT=1025
EMAIL_SMTP_NO_TLS=true
EMAIL_FROM_ADDRESS=noreply@twenty.test
EMAIL_FROM_NAME=Twenty
EOF

docker compose pull --quiet
docker compose up -d --wait --wait-timeout 600 server
docker compose up -d worker mailpit
echo "Twenty is up at http://localhost:3000"
