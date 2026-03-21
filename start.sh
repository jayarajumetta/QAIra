#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

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

echo "Starting SQLite DB initializer and API service..."
echo "Working directory: $BACKEND_DIR"

cd "$BACKEND_DIR"

exec sh -c "$COMPOSE_CMD up --build"
