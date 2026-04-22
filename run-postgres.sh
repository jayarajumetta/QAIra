#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/scripts/docker-common.sh"

PULL_IMAGES="${PULL_IMAGES:-0}"

ensure_docker

if [ "$PULL_IMAGES" = "1" ]; then
  compose_cmd -f "$SCRIPT_DIR/docker-compose.full.yml" pull postgres
fi

compose_cmd -f "$SCRIPT_DIR/docker-compose.full.yml" up -d postgres
compose_cmd -f "$SCRIPT_DIR/docker-compose.full.yml" ps postgres

echo
echo "PostgreSQL is available at localhost:${POSTGRES_PORT:-5432}"
