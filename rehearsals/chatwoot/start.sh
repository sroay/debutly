#!/usr/bin/env bash
# Starts a throwaway Chatwoot at http://localhost:3000 with Mailpit at http://localhost:8025.
set -euo pipefail
cd "$(dirname "$0")"

secret() { openssl rand -hex "$1"; }
pg_password=$(secret 16)
redis_password=$(secret 16)
cat > app.env <<EOF
SECRET_KEY_BASE=$(secret 64)
FRONTEND_URL=${PUBLIC_URL:-http://localhost:3000}
FORCE_SSL=false
ENABLE_ACCOUNT_SIGNUP=true
DISABLE_TELEMETRY=true
DEFAULT_LOCALE=en
POSTGRES_HOST=postgres
POSTGRES_USERNAME=postgres
POSTGRES_USER=postgres
POSTGRES_DB=chatwoot
POSTGRES_PASSWORD=$pg_password
REDIS_URL=redis://redis:6379
REDIS_PASSWORD=$redis_password
MAILER_SENDER_EMAIL=Chatwoot <accounts@chatwoot.test>
SMTP_DOMAIN=chatwoot.test
SMTP_ADDRESS=mailpit
SMTP_PORT=1025
SMTP_AUTHENTICATION=
SMTP_ENABLE_STARTTLS_AUTO=false
ACTIVE_STORAGE_SERVICE=local
RAILS_LOG_TO_STDOUT=true
LOG_LEVEL=warn
EOF

docker compose pull --quiet
docker compose up -d postgres redis mailpit
docker compose run --rm rails bundle exec rails db:chatwoot_prepare
docker compose up -d rails sidekiq

for _ in $(seq 180); do
  if curl -sf -o /dev/null --max-time 5 http://localhost:3000/app/login; then break; fi
  sleep 2
done
curl -sf -o /dev/null http://localhost:3000/app/login || { docker compose logs --tail 80 rails; exit 1; }
docker compose exec -T rails bundle exec rails runner - < setup.rb
echo "Chatwoot is up at http://localhost:3000"
