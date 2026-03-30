#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found in PATH."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "Docker Compose is required but was not found."
  exit 1
fi

usage() {
  cat <<EOF
Usage: ./release.sh [options]

Builds and pushes the backend + frontend Docker images, then refreshes
the docker-compose.full.yml stack by default.

Options:
  --no-deploy     Build and push images only. Skip docker compose refresh.
  --deploy        Force stack refresh after push. This is the default.
  --help          Show this help message.

Environment variables:
  DOCKER_NAMESPACE      Docker Hub namespace. Default: jayarajumetta
  IMAGE_TAG             Image tag for both images. Default: latest
  PLATFORM              Docker build platform. Default: linux/amd64
  NO_CACHE              Set to 0 to allow Docker layer cache. Default: 1
  QAIRA_BACKEND_IMAGE   Full backend image ref override
  QAIRA_FRONTEND_IMAGE  Full frontend image ref override

Examples:
  ./release.sh
  IMAGE_TAG=v1.2.0 ./release.sh
  DOCKER_NAMESPACE=myuser NO_CACHE=0 ./release.sh
  ./release.sh --no-deploy
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

DOCKER_NAMESPACE="${DOCKER_NAMESPACE:-jayarajumetta}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
NO_CACHE="${NO_CACHE:-1}"

BACKEND_IMAGE="${QAIRA_BACKEND_IMAGE:-${DOCKER_NAMESPACE}/qaira-backend:${IMAGE_TAG}}"
FRONTEND_IMAGE="${QAIRA_FRONTEND_IMAGE:-${DOCKER_NAMESPACE}/qaira-frontend:${IMAGE_TAG}}"

if [ "$NO_CACHE" = "0" ]; then
  NO_CACHE_FLAG=""
else
  NO_CACHE_FLAG="--no-cache"
fi

echo "Releasing QAIra images"
echo "Root: $SCRIPT_DIR"
echo "Backend image: $BACKEND_IMAGE"
echo "Frontend image: $FRONTEND_IMAGE"
echo "Platform: $PLATFORM"
echo "No cache: $NO_CACHE"

echo
echo "Checking Docker daemon..."
docker info >/dev/null

echo
echo "Building backend image..."
docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$BACKEND_IMAGE" "$SCRIPT_DIR/backend"

echo
echo "Building frontend image..."
docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$FRONTEND_IMAGE" "$SCRIPT_DIR/frontend"

echo
echo "Pushing backend image..."
docker push "$BACKEND_IMAGE"

echo
echo "Pushing frontend image..."
docker push "$FRONTEND_IMAGE"

if [ "$DEPLOY_STACK" = "1" ]; then
  echo
  echo "Refreshing full stack..."
  QAIRA_BACKEND_IMAGE="$BACKEND_IMAGE" \
  QAIRA_FRONTEND_IMAGE="$FRONTEND_IMAGE" \
    sh -c "$COMPOSE_CMD -f \"$SCRIPT_DIR/docker-compose.full.yml\" pull && $COMPOSE_CMD -f \"$SCRIPT_DIR/docker-compose.full.yml\" up -d --force-recreate"

  echo
  echo "Current stack:"
  QAIRA_BACKEND_IMAGE="$BACKEND_IMAGE" \
  QAIRA_FRONTEND_IMAGE="$FRONTEND_IMAGE" \
    sh -c "$COMPOSE_CMD -f \"$SCRIPT_DIR/docker-compose.full.yml\" ps"
fi

echo
echo "Release complete."
echo "Frontend: http://localhost:8080"
echo "Backend: http://localhost:3000"
