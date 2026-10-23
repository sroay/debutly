#!/usr/bin/env bash
# unseal.sh <private key> <downloaded artifact dir> <out dir>: the reverse of seal.sh.
set -euo pipefail
private_key=$1 sealed=$2 out=$3
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
openssl pkeyutl -decrypt -inkey "$private_key" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
  -in "$sealed/key.enc" -out "$work/key"
openssl enc -d -aes-256-cbc -pbkdf2 -in "$sealed/report.tgz.enc" -out "$work/report.tgz" -pass stdin < "$work/key"
mkdir -p "$out"
tar -xzf "$work/report.tgz" -C "$out"
echo "Report in $out/report.md"
