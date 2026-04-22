#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/scripts/docker-common.sh"

PULL_IMAGES="${PULL_IMAGES:-0}"

ensure_docker

if [ "$PULL_IMAGES" = "1" ]; then
  QAIRA_BACKEND_IMAGE="${QAIRA_BACKEND_IMAGE:-jayarajumetta/qaira-backend:latest}" \
    compose_cmd -f "$SCRIPT_DIR/docker-compose.full.yml" pull api
fi

QAIRA_BACKEND_IMAGE="${QAIRA_BACKEND_IMAGE:-jayarajumetta/qaira-backend:latest}" \
  compose_cmd -f "$SCRIPT_DIR/docker-compose.full.yml" up -d api
QAIRA_BACKEND_IMAGE="${QAIRA_BACKEND_IMAGE:-jayarajumetta/qaira-backend:latest}" \
  compose_cmd -f "$SCRIPT_DIR/docker-compose.full.yml" ps api

echo
echo "Backend is available at http://localhost:3000"
