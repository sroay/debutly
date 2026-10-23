#!/usr/bin/env bash
# serve.sh: opens temporary https addresses (Cloudflare quick tunnels, no account) to the app at
# localhost:3000 and its Mailpit at localhost:8025, so a person can check findings by hand in
# their own browser and screen reader. Run before the app's start.sh, which takes PUBLIC_URL as
# the app's own address. The addresses are masked in the log and uploaded sealed, like reports:
# for report-key.pem's holder, or for SEAL_KEY (a public key) when another job reads them.
set -euo pipefail
VERSION=2026.10.0

curl -sSfL -o "$RUNNER_TEMP/cloudflared" "https://github.com/cloudflare/cloudflared/releases/download/$VERSION/cloudflared-linux-amd64"
chmod +x "$RUNNER_TEMP/cloudflared"

tunnel() {
  local port=$1 log="$RUNNER_TEMP/tunnel-$1.log"
  nohup "$RUNNER_TEMP/cloudflared" tunnel --no-autoupdate --url "http://localhost:$port" > "$log" 2>&1 &
  for _ in $(seq 60); do
    local url
    url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$log" | head -1 || true)
    if [ -n "$url" ]; then echo "$url"; return; fi
    sleep 1
  done
  echo "::error title=Rehearsal::No tunnel address for port $port." >&2
  return 1
}

app=$(tunnel 3000)
mail=$(tunnel 8025)
# The mailbox holds every sign-up link, so it takes a password (Mailpit's own, for its pages and API).
mail_login="checker:$(openssl rand -hex 12)"
echo "::add-mask::$app"
echo "::add-mask::$mail"
echo "::add-mask::$mail_login"
{ echo "PUBLIC_URL=$app"; echo "MAIL_URL=$mail"; echo "MAILPIT_AUTH=$mail_login"; } >> "$GITHUB_ENV"
# A run's log can only be read once it ends, so the addresses go out as a file the run uploads.
mkdir -p "$RUNNER_TEMP/addresses"
printf 'app %s\nmail %s\nmail login %s\n' "$app" "$mail" "$mail_login" |
  openssl pkeyutl -encrypt -pubin -inkey "${SEAL_KEY:-$(dirname "$0")/report-key.pem}" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 |
  base64 -w0 > "$RUNNER_TEMP/addresses/sealed.txt"
echo "Addresses sealed for the holder of report-key.pem."
