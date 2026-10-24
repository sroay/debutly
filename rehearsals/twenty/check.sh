#!/usr/bin/env bash
# Before spending anything on agents: the app answers and Mailpit is up. Twenty's first sign-up
# creates the only workspace, so this check doesn't sign up; that is the owner agent's job.
set -euo pipefail

curl -sf -o /dev/null http://localhost:3000/healthz
curl -sf http://localhost:3000/ | grep -qi "<title>Twenty" || { echo "::error title=Rehearsal setup::Twenty's front page didn't load."; exit 1; }
curl -sf -o /dev/null ${MAILPIT_AUTH:+-u "$MAILPIT_AUTH"} http://localhost:8025/api/v1/messages
echo "Twenty and Mailpit answer."

# What the first page weighs as sent, for reading a slow-connection agent's result.
bash "$(dirname "$0")/../weight.sh" http://localhost:3000/
