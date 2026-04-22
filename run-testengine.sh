#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/scripts/docker-common.sh"

PULL_IMAGES="${PULL_IMAGES:-1}"

ensure_docker

if [ "$PULL_IMAGES" = "1" ]; then
  QAIRA_TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-jayarajumetta/qaira-testengine:latest}" \
    compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" pull testengine
fi

QAIRA_TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-jayarajumetta/qaira-testengine:latest}" \
  compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" up -d testengine
QAIRA_TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-jayarajumetta/qaira-testengine:latest}" \
  compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" ps testengine

echo
echo "Test Engine is available at http://localhost:${TESTENGINE_PORT:-4301}"
