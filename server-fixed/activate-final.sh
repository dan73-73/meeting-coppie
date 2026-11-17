#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker compose build relay
docker compose stop relay
trap 'docker compose up -d relay' EXIT
docker compose run --rm --no-deps -e IMPORT_FINAL_FIREBASE=YES -v "$PWD/import-final.mjs:/app/import-final.mjs:ro" relay node /app/import-final.mjs
