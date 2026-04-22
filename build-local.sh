#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/scripts/docker-common.sh"

usage() {
  cat <<EOF
Usage: ./build-local.sh [options]

Builds the backend + frontend + Test Engine Docker images locally without pushing them.
By default, it also refreshes the docker-compose.full.yml stack using the
newly built local images.

Options:
  --no-deploy     Build images only. Skip docker compose refresh.
  --deploy        Force stack refresh after build. This is the default.
  --help          Show this help message.

Environment variables:
  IMAGE_TAG             Image tag for all three images. Default: local
  PLATFORM              Docker build platform. Default: linux/amd64
  NO_CACHE              Set to 0 to allow Docker layer cache. Default: 1
  QAIRA_BACKEND_IMAGE   Full backend image ref override
  QAIRA_FRONTEND_IMAGE  Full frontend image ref override
  QAIRA_TESTENGINE_IMAGE Full Test Engine image ref override

Examples:
  ./build-local.sh
  IMAGE_TAG=dev ./build-local.sh
  NO_CACHE=0 ./build-local.sh --no-deploy
  QAIRA_BACKEND_IMAGE=my-qaira-backend:dev QAIRA_FRONTEND_IMAGE=my-qaira-frontend:dev QAIRA_TESTENGINE_IMAGE=my-qaira-testengine:dev ./build-local.sh
EOF
}

DEPLOY_STACK=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-deploy)
      DEPLOY_STACK=0
      ;;
    --deploy)
      DEPLOY_STACK=1
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

IMAGE_TAG="${IMAGE_TAG:-local}"
PLATFORM="${PLATFORM:-linux/amd64}"
NO_CACHE="${NO_CACHE:-1}"

BACKEND_IMAGE="${QAIRA_BACKEND_IMAGE:-qaira-backend:${IMAGE_TAG}}"
FRONTEND_IMAGE="${QAIRA_FRONTEND_IMAGE:-qaira-frontend:${IMAGE_TAG}}"
TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-qaira-testengine:${IMAGE_TAG}}"

if [ "$NO_CACHE" = "0" ]; then
  NO_CACHE_FLAG=""
else
  NO_CACHE_FLAG="--no-cache"
fi

echo "Building QAIra images locally"
echo "Root: $SCRIPT_DIR"
echo "Backend image: $BACKEND_IMAGE"
echo "Frontend image: $FRONTEND_IMAGE"
echo "Test Engine image: $TESTENGINE_IMAGE"
echo "Platform: $PLATFORM"
echo "No cache: $NO_CACHE"

echo
echo "Checking Docker daemon..."
ensure_docker

echo
echo "Building backend image..."
docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$BACKEND_IMAGE" "$SCRIPT_DIR/backend"

echo
echo "Building frontend image..."
docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$FRONTEND_IMAGE" "$SCRIPT_DIR/frontend"

echo
echo "Building Test Engine image..."
docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$TESTENGINE_IMAGE" -f "$SCRIPT_DIR/testengine/backend/Dockerfile" "$SCRIPT_DIR/testengine/backend"

if [ "$DEPLOY_STACK" = "1" ]; then
  echo
  echo "Refreshing full stack with local images..."
  QAIRA_BACKEND_IMAGE="$BACKEND_IMAGE" \
  QAIRA_FRONTEND_IMAGE="$FRONTEND_IMAGE" \
    compose_cmd -f "$SCRIPT_DIR/docker-compose.full.yml" up -d --force-recreate

  echo
  echo "Current stack:"
  QAIRA_BACKEND_IMAGE="$BACKEND_IMAGE" \
  QAIRA_FRONTEND_IMAGE="$FRONTEND_IMAGE" \
    compose_cmd -f "$SCRIPT_DIR/docker-compose.full.yml" ps
fi

echo
echo "Local build complete."
echo "Frontend image: $FRONTEND_IMAGE"
echo "Backend image: $BACKEND_IMAGE"
echo "Test Engine image: $TESTENGINE_IMAGE"
echo "Frontend: http://localhost:8080"
echo "Backend: http://localhost:3000"
