#!/usr/bin/env bash
# unseal.sh <private key> <downloaded artifact dir> <out dir>: the reverse of seal.sh.
# unseal.sh --links <private key> <sealed text>: the addresses and mailbox login serve.sh sealed.
set -euo pipefail
if [ "$1" = "--links" ]; then
  printf '%s' "$3" | base64 -d | openssl pkeyutl -decrypt -inkey "$2" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256
  exit 0
fi
private_key=$1 sealed=$2 out=$3
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
openssl pkeyutl -decrypt -inkey "$private_key" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
  -in "$sealed/key.enc" -out "$work/key"
openssl enc -d -aes-256-cbc -pbkdf2 -in "$sealed/report.tgz.enc" -out "$work/report.tgz" -pass stdin < "$work/key"
mkdir -p "$out"
tar -xzf "$work/report.tgz" -C "$out"
echo "Report in $out/report.md"
