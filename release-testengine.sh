#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/scripts/docker-common.sh"

usage() {
  cat <<EOF
Usage: ./release-testengine.sh [options]

Pulls the published Test Engine image and refreshes the standalone
docker-compose deployment for a separate host such as an EC2 worker.

Options:
  --no-pull       Reuse the local image reference and skip docker pull.
  --help          Show this help message.

Environment variables:
  QAIRA_TESTENGINE_IMAGE  Full Test Engine image ref. Default: jayarajumetta/qaira-testengine:latest
  TESTENGINE_PORT         Host port for the container. Default: 4301

Examples:
  ./release-testengine.sh
  QAIRA_TESTENGINE_IMAGE=myuser/qaira-testengine:v1 ./release-testengine.sh
  ./release-testengine.sh --no-pull
EOF
}

PULL_IMAGE=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-pull)
      PULL_IMAGE=0
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo
      usage
      exit 1
      ;;
  esac
  shift
done

QAIRA_TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-jayarajumetta/qaira-testengine:latest}"

ensure_docker

if [ "$PULL_IMAGE" = "1" ]; then
  QAIRA_TESTENGINE_IMAGE="$QAIRA_TESTENGINE_IMAGE" \
    compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" pull testengine
fi

QAIRA_TESTENGINE_IMAGE="$QAIRA_TESTENGINE_IMAGE" \
  compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" up -d --force-recreate testengine
QAIRA_TESTENGINE_IMAGE="$QAIRA_TESTENGINE_IMAGE" \
  compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" ps testengine

echo
echo "Test Engine deployed."
echo "Image: $QAIRA_TESTENGINE_IMAGE"
echo "Health: http://localhost:${TESTENGINE_PORT:-4301}/health"
