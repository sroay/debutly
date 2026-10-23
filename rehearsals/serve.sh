#!/usr/bin/env bash
# serve.sh: opens temporary https addresses (Cloudflare quick tunnels, no account) to the app at
# localhost:3000 and its Mailpit at localhost:8025, so a person can check findings by hand in
# their own browser and screen reader. Run before the app's start.sh, which takes PUBLIC_URL as
# the app's own address. The addresses are masked in the log and printed sealed, like reports.
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
echo "::add-mask::$app"
echo "::add-mask::$mail"
{ echo "PUBLIC_URL=$app"; echo "MAIL_URL=$mail"; } >> "$GITHUB_ENV"
sealed=$(printf 'app %s\nmail %s\n' "$app" "$mail" |
  openssl pkeyutl -encrypt -pubin -inkey "$(dirname "$0")/report-key.pem" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 | base64 -w0)
echo "Sealed addresses (open with unseal.sh --links): $sealed"
