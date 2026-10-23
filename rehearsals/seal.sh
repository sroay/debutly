#!/usr/bin/env bash
# seal.sh <report dir> <out dir>: encrypts a rehearsal's report for the holder of the private half
# of report-key.pem. Findings on someone else's app stay unpublished until a person has checked
# them, and this repo's run artifacts are public. A fresh AES-256 key per report, sealed with RSA-OAEP.
set -euo pipefail
report=$1 out=$2
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"
tar -czf "$work/report.tgz" -C "$report" .
openssl rand -hex 32 > "$work/key"
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$work/report.tgz" -out "$out/report.tgz.enc" -pass stdin < "$work/key"
openssl pkeyutl -encrypt -pubin -inkey "$(dirname "$0")/report-key.pem" \
  -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$work/key" -out "$out/key.enc"
echo "Sealed $(du -sh "$out/report.tgz.enc" | cut -f1) of report."
