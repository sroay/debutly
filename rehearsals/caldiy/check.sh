#!/usr/bin/env bash
# Before spending anything on agents: the sign-in page loads as a returning visitor sees it (not
# the first-run admin setup), sign-up is open, and Mailpit answers.
set -euo pipefail

final=$(curl -s -o /dev/null -w "%{url_effective}" -L http://localhost:3000/auth/login)
case "$final" in
  */auth/setup*) echo "::error title=Rehearsal setup::Cal.diy still sends visitors to its first-run setup."; exit 1 ;;
esac
curl -sf -o /dev/null http://localhost:3000/signup || { echo "::error title=Rehearsal setup::Cal.diy's sign-up page didn't load."; exit 1; }
curl -sf -o /dev/null ${MAILPIT_AUTH:+-u "$MAILPIT_AUTH"} http://localhost:8025/api/v1/messages
echo "Cal.diy and Mailpit answer, and sign-up is open."
