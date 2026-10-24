#!/usr/bin/env bash
# What a page's scripts and styles weigh as sent, and whether they come compressed. Real hosting
# compresses them; an app served straight from its container may not, and then a slow-connection
# agent waits for far more than a real customer would. Prints only; never fails the run.
# Usage: weight.sh <page url>
set -uo pipefail

page="$1"
origin=$(node -p 'new URL(process.argv[1]).origin' "$page")
html=$(curl -sL --max-time 30 "$page") || { echo "Couldn't fetch $page to weigh it."; exit 0; }
assets=$(printf '%s' "$html" | grep -oE '<(script[^>]+src|link[^>]+href)="[^"]+\.(js|css)[^"]*"' | grep -oE '(src|href)="[^"]+"' | cut -d'"' -f2 | sort -u)
total=0
plain=0
count=0
for asset in $assets; do
  url=$(node -p 'new URL(process.argv[1], process.argv[2]).href' "$asset" "$origin")
  read -r bytes encoding < <(curl -s --max-time 60 -o /dev/null -H 'Accept-Encoding: gzip, br' -w '%{size_download} %header{content-encoding}\n' "$url")
  total=$((total + bytes))
  count=$((count + 1))
  if [ -z "${encoding:-}" ]; then plain=$((plain + bytes)); fi
done
echo "First page ($page): $count scripts and styles, $((total / 1024)) KB as sent, $((plain / 1024)) KB of it uncompressed."
