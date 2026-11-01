#!/usr/bin/env bash
set -euo pipefail

: "${VPS_HOST:?set VPS_HOST, e.g. root@203.0.113.10}"
: "${VPS_PORT:=22}"
: "${VPS_PATH:=/opt/wazup}"

bundle="$(mktemp -t wazam-deploy).tar.gz"

echo "packing source (secrets and artifacts excluded)"
tar czf "$bundle" \
  --exclude='./node_modules' \
  --exclude='*/node_modules' \
  --exclude='./.git' \
  --exclude='./dist' \
  --exclude='*/dist' \
  --exclude='./.claude' \
  --exclude='./.playwright-mcp' \
  --exclude='*.tsbuildinfo' \
  --exclude='./.env' \
  --exclude='./.env.*' \
  .

echo "uploading to ${VPS_HOST}:${VPS_PATH}"
scp -P "$VPS_PORT" "$bundle" "${VPS_HOST}:/tmp/wazam-deploy.tar.gz"

ssh -p "$VPS_PORT" "$VPS_HOST" VPS_PATH="$VPS_PATH" bash -s <<'REMOTE'
set -euo pipefail
mkdir -p "$VPS_PATH"
tar xzf /tmp/wazam-deploy.tar.gz -C "$VPS_PATH"
rm -f /tmp/wazam-deploy.tar.gz
cd "$VPS_PATH"
if [ ! -f .env ]; then
  echo "FATAL: $VPS_PATH/.env is missing — refusing to deploy" >&2
  exit 1
fi
docker compose build api web
docker compose up -d
docker compose ps
REMOTE

rm -f "$bundle"
echo "deploy complete"
