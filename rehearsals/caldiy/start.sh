#!/usr/bin/env bash
# Builds Cal.diy at one commit from its own Dockerfile and starts it at http://localhost:3000, with
# Mailpit at http://localhost:8025. The build takes about half an hour on a GitHub runner.
set -euo pipefail
cd "$(dirname "$0")"

COMMIT=0f19cc46ef6b6426ee398c670575b3c96be7af9e # main on 2026-10-19

# The build needs more disk than a runner has free; these preinstalled toolchains aren't used here.
if [ -n "${CI:-}" ]; then
  sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL
  df -h / | tail -1
fi

if [ ! -d src ]; then
  git init -q src
  git -C src fetch -q --depth 1 https://github.com/calcom/cal.diy "$COMMIT"
  git -C src checkout -q FETCH_HEAD
fi

secret() { openssl rand -hex "$1"; }
pg_password=$(secret 16)
cat > app.env <<EOF
POSTGRES_USER=calcom
POSTGRES_PASSWORD=$pg_password
POSTGRES_DB=calcom
DATABASE_HOST=database:5432
DATABASE_URL=postgresql://calcom:$pg_password@database:5432/calcom
DATABASE_DIRECT_URL=postgresql://calcom:$pg_password@database:5432/calcom
NEXT_PUBLIC_WEBAPP_URL=http://localhost:3000
NEXT_PUBLIC_WEBSITE_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=$(secret 32)
CALENDSO_ENCRYPTION_KEY=$(secret 16)
CALCOM_TELEMETRY_DISABLED=1
EMAIL_FROM=notifications@caldiy.test
EMAIL_FROM_NAME=Cal.diy
EMAIL_SERVER_HOST=mailpit
EMAIL_SERVER_PORT=1025
EOF

docker build --progress=plain -t rehearse-caldiy:local \
  --build-arg NEXT_PUBLIC_WEBAPP_URL=http://localhost:3000 \
  --build-arg CALCOM_TELEMETRY_DISABLED=1 \
  src

docker compose up -d
# Migrations and the app store's seeding run before the server starts.
for _ in $(seq 300); do
  if curl -sf -o /dev/null --max-time 5 http://localhost:3000/auth/login; then break; fi
  sleep 2
done
curl -sf -o /dev/null http://localhost:3000/auth/login || { docker compose logs --tail 80 calcom; exit 1; }

# A brand-new install sends its first visitor to set up the server's admin. One sign-up through
# its own API gets past that, so every agent meets the public sign-up as a new customer would.
curl -sf -X POST http://localhost:3000/api/auth/signup -H "Content-Type: application/json" \
  -d "{\"username\":\"setup-admin\",\"email\":\"setup-admin@caldiy.test\",\"password\":\"Aa1!$(secret 8)\",\"language\":\"en\"}" > /dev/null
echo "Cal.diy is up at http://localhost:3000"
