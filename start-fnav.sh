#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
set -a
. ./.env
set +a
exec node server/index.js
