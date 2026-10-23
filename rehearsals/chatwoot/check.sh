#!/usr/bin/env bash
# Before spending anything on agents: a sign-up through Chatwoot's own API must reach Mailpit as
# a confirmation email, or the agents could never confirm theirs.
set -euo pipefail

email="check-$(openssl rand -hex 4)@agents.test"
password="Aa1!$(openssl rand -hex 8)"
curl -sf -X POST http://localhost:3000/api/v1/accounts -H "Content-Type: application/json" \
  -d "{\"account_name\":\"Setup check\",\"user_full_name\":\"Setup check\",\"email\":\"$email\",\"password\":\"$password\"}" > /dev/null

for _ in $(seq 30); do
  count=$(curl -sf "http://localhost:8025/api/v1/search?query=to:%22$email%22" | node -p '(JSON.parse(require("fs").readFileSync(0)).messages ?? []).length')
  if [ "$count" -gt 0 ]; then echo "Sign-up works and its confirmation email arrives."; exit 0; fi
  sleep 2
done
echo "::error title=Rehearsal setup::No confirmation email reached Mailpit for a test sign-up."
docker compose -f "$(dirname "$0")/compose.yaml" logs --tail 60 sidekiq
exit 1
