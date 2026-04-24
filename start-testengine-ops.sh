#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/scripts/docker-common.sh"

usage() {
  cat <<EOF
Usage: ./start-testengine-ops.sh [options]

Starts the standalone Test Engine stack with QAira API and OPS/OTEL settings in one place.

Options:
  --no-pull       Reuse current local image references and skip docker pull.
  --help          Show this help message.

Required environment variables:
  QAIRA_API_BASE_URL      QAira public API base URL, for example https://qaira.qualipal.in/api
  QAIRA_TESTENGINE_SECRET Shared secret used by QAira and the Test Engine queue APIs

Optional environment variables:
  QAIRA_TESTENGINE_IMAGE  Default: jayarajumetta/qaira-testengine:latest
  QAIRA_TESTENGINE_SECRET Shared secret used by QAira and the Test Engine queue APIs
  ENGINE_PUBLIC_URL       Public URL of this Test Engine host
  TESTENGINE_PORT         Host port for the engine container. Default: 4301
  OPS_OTLP_ENDPOINT       OTLP/OPS collector endpoint to inject as OTEL_EXPORTER_OTLP_ENDPOINT
  OTEL_EXPORTER_OTLP_ENDPOINT
  OTEL_SERVICE_NAME       Default: qaira-testengine
  OTEL_RESOURCE_ATTRIBUTES
  OPS_ENVIRONMENT         Default: production

Example:
  QAIRA_API_BASE_URL=https://qaira.qualipal.in/api \\
  QAIRA_TESTENGINE_SECRET=your-shared-secret \\
  ENGINE_PUBLIC_URL=https://engine.qualipal.in \\
  OPS_OTLP_ENDPOINT=https://ops.company.internal:4318 \\
  ./start-testengine-ops.sh
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

QAIRA_API_BASE_URL="${QAIRA_API_BASE_URL:-}"
QAIRA_TESTENGINE_SECRET="${QAIRA_TESTENGINE_SECRET:-}"
QAIRA_TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-jayarajumetta/qaira-testengine:latest}"
TESTENGINE_PORT="${TESTENGINE_PORT:-4301}"
ENGINE_PUBLIC_URL="${ENGINE_PUBLIC_URL:-http://localhost:${TESTENGINE_PORT}}"
OPS_ENVIRONMENT="${OPS_ENVIRONMENT:-production}"
OTEL_EXPORTER_OTLP_ENDPOINT="${OPS_OTLP_ENDPOINT:-${OTEL_EXPORTER_OTLP_ENDPOINT:-}}"
OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-qaira-testengine}"
OTEL_RESOURCE_ATTRIBUTES="${OTEL_RESOURCE_ATTRIBUTES:-service.name=${OTEL_SERVICE_NAME},deployment.environment=${OPS_ENVIRONMENT}}"

if [ -z "$QAIRA_API_BASE_URL" ]; then
  echo "QAIRA_API_BASE_URL is required."
  echo "Example: QAIRA_API_BASE_URL=https://qaira.qualipal.in/api ./start-testengine-ops.sh"
  exit 1
fi

if [ -z "$QAIRA_TESTENGINE_SECRET" ]; then
  echo "QAIRA_TESTENGINE_SECRET is required."
  echo "Use the same shared secret on the QAira API host and the Test Engine host."
  exit 1
fi

ensure_docker

echo "Starting Test Engine stack..."
echo "QAira API base: $QAIRA_API_BASE_URL"
echo "Engine public URL: $ENGINE_PUBLIC_URL"
if [ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]; then
  echo "OPS OTLP endpoint: $OTEL_EXPORTER_OTLP_ENDPOINT"
else
  echo "OPS OTLP endpoint: not configured"
fi

if [ "$PULL_IMAGE" = "1" ]; then
  QAIRA_TESTENGINE_IMAGE="$QAIRA_TESTENGINE_IMAGE" \
  QAIRA_API_BASE_URL="$QAIRA_API_BASE_URL" \
  QAIRA_TESTENGINE_SECRET="$QAIRA_TESTENGINE_SECRET" \
  ENGINE_PUBLIC_URL="$ENGINE_PUBLIC_URL" \
  OTEL_EXPORTER_OTLP_ENDPOINT="$OTEL_EXPORTER_OTLP_ENDPOINT" \
  OTEL_SERVICE_NAME="$OTEL_SERVICE_NAME" \
  OTEL_RESOURCE_ATTRIBUTES="$OTEL_RESOURCE_ATTRIBUTES" \
    compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" pull testengine selenium-hub selenium-node-chrome
fi

QAIRA_TESTENGINE_IMAGE="$QAIRA_TESTENGINE_IMAGE" \
QAIRA_API_BASE_URL="$QAIRA_API_BASE_URL" \
QAIRA_TESTENGINE_SECRET="$QAIRA_TESTENGINE_SECRET" \
ENGINE_PUBLIC_URL="$ENGINE_PUBLIC_URL" \
OTEL_EXPORTER_OTLP_ENDPOINT="$OTEL_EXPORTER_OTLP_ENDPOINT" \
OTEL_SERVICE_NAME="$OTEL_SERVICE_NAME" \
OTEL_RESOURCE_ATTRIBUTES="$OTEL_RESOURCE_ATTRIBUTES" \
  compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" up -d testengine selenium-hub selenium-node-chrome

QAIRA_TESTENGINE_IMAGE="$QAIRA_TESTENGINE_IMAGE" \
QAIRA_API_BASE_URL="$QAIRA_API_BASE_URL" \
QAIRA_TESTENGINE_SECRET="$QAIRA_TESTENGINE_SECRET" \
ENGINE_PUBLIC_URL="$ENGINE_PUBLIC_URL" \
OTEL_EXPORTER_OTLP_ENDPOINT="$OTEL_EXPORTER_OTLP_ENDPOINT" \
OTEL_SERVICE_NAME="$OTEL_SERVICE_NAME" \
OTEL_RESOURCE_ATTRIBUTES="$OTEL_RESOURCE_ATTRIBUTES" \
  compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" ps

echo
echo "Test Engine stack is running."
echo "Health: http://localhost:${TESTENGINE_PORT}/health"
