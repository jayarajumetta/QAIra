#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/scripts/docker-common.sh"

usage() {
  cat <<EOF
Usage: ./start-testengine-ops.sh [options]

Starts the standalone Test Engine stack and aligns its OPS telemetry settings with the
current QAira integrations whenever auth is available.

Options:
  --no-pull       Reuse current local image references and skip docker pull.
  --help          Show this help message.

Required environment variables:
  QAIRA_API_BASE_URL       QAira public API base URL, for example https://qaira.qualipal.in/api
  QAIRA_TESTENGINE_SECRET  Shared secret used by QAira and the Test Engine queue APIs

Optional environment variables:
  QAIRA_TESTENGINE_IMAGE   Default: jayarajumetta/qaira-testengine:latest
  QAIRA_PROJECT_ID         Resolve project-scoped Test Engine and OPS integrations first
  QAIRA_AUTH_TOKEN         Read active integrations from QAira with this bearer token
  QAIRA_AUTH_EMAIL         Login email used when QAIRA_AUTH_TOKEN is not provided
  QAIRA_AUTH_PASSWORD      Login password paired with QAIRA_AUTH_EMAIL
  ENGINE_PUBLIC_URL        Public URL of this Test Engine host. Falls back to active integration, then localhost
  TESTENGINE_PORT          Host port for the engine container. Default: 4301
  OPS_OTLP_ENDPOINT        Optional OTLP endpoint to inject as OTEL_EXPORTER_OTLP_ENDPOINT
  OTEL_EXPORTER_OTLP_ENDPOINT
  OTEL_SERVICE_NAME        Defaults to the active OPS service_name or qaira-testengine
  OTEL_RESOURCE_ATTRIBUTES Defaults to service.name + deployment.environment
  OPS_ENVIRONMENT          Defaults to the active OPS environment or production
  OPS_TELEMETRY_EVENTS_PATH
  OPS_TELEMETRY_BOARD_PATH
  OPS_TELEMETRY_API_KEY
  OPS_TELEMETRY_API_KEY_HEADER
  OPS_TELEMETRY_API_KEY_PREFIX
  OPS_TELEMETRY_MAX_EVENTS Default: 2000
  OPS_TELEMETRY_STORE_PATH Default: /artifacts/ops-telemetry-events.ndjson
  QAIRA_SELENIUM_HUB_IMAGE
  QAIRA_SELENIUM_NODE_IMAGE
  SELENIUM_GRID_PORT
  LOG_LEVEL

Example:
  QAIRA_API_BASE_URL=https://qaira.qualipal.in/api \\
  QAIRA_TESTENGINE_SECRET=your-shared-secret \\
  QAIRA_AUTH_TOKEN=replace-with-a-qaira-token \\
  QAIRA_PROJECT_ID=replace-with-project-id \\
  ./start-testengine-ops.sh
EOF
}

print_block() {
  prefix="$1"
  text="$2"

  if [ -z "$text" ]; then
    return 0
  fi

  printf '%s\n' "$text" | while IFS= read -r line; do
    if [ -n "$line" ]; then
      echo "${prefix}${line}"
    fi
  done
}

normalize_path() {
  value="$1"
  fallback="$2"

  if [ -z "$value" ]; then
    value="$fallback"
  fi

  case "$value" in
    /*) printf '%s' "$value" ;;
    *) printf '/%s' "$value" ;;
  esac
}

wait_for_url() {
  url="$1"
  label="$2"

  if ! command -v curl >/dev/null 2>&1; then
    echo "Skipping ${label} readiness check because curl is not installed."
    return 0
  fi

  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      echo "${label} is responding at ${url}"
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  echo "Warning: ${label} did not respond at ${url} within 60 seconds."
  return 0
}

resolve_from_integrations() {
  if ! command -v node >/dev/null 2>&1; then
    if [ -n "${QAIRA_AUTH_TOKEN:-}${QAIRA_AUTH_EMAIL:-}${QAIRA_AUTH_PASSWORD:-}${QAIRA_PROJECT_ID:-}" ]; then
      echo "Node.js is required to resolve Test Engine and OPS settings from QAira integrations."
      exit 1
    fi
    return 0
  fi

  eval "$(node "$SCRIPT_DIR/scripts/resolve-testengine-ops-config.mjs")"

  print_block "Integration: " "${RESOLVED_INFO_TEXT:-}"
  print_block "Warning: " "${RESOLVED_WARNING_TEXT:-}"
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
OPS_ENVIRONMENT="${OPS_ENVIRONMENT:-}"
OTEL_EXPORTER_OTLP_ENDPOINT="${OPS_OTLP_ENDPOINT:-${OTEL_EXPORTER_OTLP_ENDPOINT:-}}"
OPS_TELEMETRY_MAX_EVENTS="${OPS_TELEMETRY_MAX_EVENTS:-2000}"

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

resolve_from_integrations

DEFAULT_ENGINE_PUBLIC_URL="http://localhost:${TESTENGINE_PORT}"
ENGINE_PUBLIC_URL="${ENGINE_PUBLIC_URL:-${RESOLVED_ENGINE_PUBLIC_URL:-$DEFAULT_ENGINE_PUBLIC_URL}}"
OPS_TELEMETRY_EVENTS_PATH="${OPS_TELEMETRY_EVENTS_PATH:-${RESOLVED_OPS_EVENTS_PATH:-/api/v1/events}}"
OPS_TELEMETRY_BOARD_PATH="${OPS_TELEMETRY_BOARD_PATH:-${RESOLVED_OPS_BOARD_PATH:-/ops-telemetry}}"
OPS_ENVIRONMENT="${OPS_ENVIRONMENT:-${RESOLVED_OPS_ENVIRONMENT:-production}}"
OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-${RESOLVED_OPS_SERVICE_NAME:-qaira-testengine}}"
OPS_TELEMETRY_SERVICE_NAME="${OPS_TELEMETRY_SERVICE_NAME:-$OTEL_SERVICE_NAME}"
OPS_TELEMETRY_ENVIRONMENT="${OPS_TELEMETRY_ENVIRONMENT:-$OPS_ENVIRONMENT}"
OPS_TELEMETRY_API_KEY="${OPS_TELEMETRY_API_KEY:-${RESOLVED_OPS_API_KEY:-}}"
OPS_TELEMETRY_API_KEY_HEADER="${OPS_TELEMETRY_API_KEY_HEADER:-${RESOLVED_OPS_API_KEY_HEADER:-Authorization}}"
OTEL_RESOURCE_ATTRIBUTES="${OTEL_RESOURCE_ATTRIBUTES:-service.name=${OTEL_SERVICE_NAME},deployment.environment=${OPS_ENVIRONMENT}}"

if [ "${OPS_TELEMETRY_API_KEY_PREFIX+x}" = "x" ]; then
  OPS_TELEMETRY_API_KEY_PREFIX="$OPS_TELEMETRY_API_KEY_PREFIX"
elif [ "${RESOLVED_OPS_API_KEY_PREFIX+x}" = "x" ]; then
  OPS_TELEMETRY_API_KEY_PREFIX="$RESOLVED_OPS_API_KEY_PREFIX"
else
  OPS_TELEMETRY_API_KEY_PREFIX="Bearer"
fi

if [ "$ENGINE_PUBLIC_URL" = "$DEFAULT_ENGINE_PUBLIC_URL" ] && [ -z "${RESOLVED_ENGINE_PUBLIC_URL:-}" ]; then
  echo "Warning: Using the fallback engine URL ${ENGINE_PUBLIC_URL}. Set ENGINE_PUBLIC_URL or provide QAira auth if the active Test Engine integration already points at a hosted URL."
fi

LOCAL_OPS_EVENTS_PATH="$(normalize_path "$OPS_TELEMETRY_EVENTS_PATH" "/api/v1/events")"
LOCAL_OPS_BOARD_PATH="$(normalize_path "$OPS_TELEMETRY_BOARD_PATH" "/ops-telemetry")"
LOCAL_HEALTH_URL="http://127.0.0.1:${TESTENGINE_PORT}/health"
LOCAL_EVENTS_URL="http://127.0.0.1:${TESTENGINE_PORT}${LOCAL_OPS_EVENTS_PATH}"
LOCAL_BOARD_URL="http://127.0.0.1:${TESTENGINE_PORT}${LOCAL_OPS_BOARD_PATH}"
PUBLIC_OPS_TRANSPORT_HOST="${RESOLVED_OPS_TRANSPORT_HOST:-$ENGINE_PUBLIC_URL}"
PUBLIC_OPS_HEALTH_URL="${RESOLVED_OPS_HEALTH_URL:-${ENGINE_PUBLIC_URL}/health}"
PUBLIC_OPS_EVENTS_URL="${RESOLVED_OPS_EVENTS_URL:-${PUBLIC_OPS_TRANSPORT_HOST}${LOCAL_OPS_EVENTS_PATH}}"
PUBLIC_OPS_BOARD_URL="${RESOLVED_OPS_BOARD_URL:-${PUBLIC_OPS_TRANSPORT_HOST}${LOCAL_OPS_BOARD_PATH}}"

export QAIRA_TESTENGINE_IMAGE
export QAIRA_API_BASE_URL
export QAIRA_TESTENGINE_SECRET
export ENGINE_PUBLIC_URL
export TESTENGINE_PORT
export OTEL_EXPORTER_OTLP_ENDPOINT
export OTEL_SERVICE_NAME
export OTEL_RESOURCE_ATTRIBUTES
export OPS_TELEMETRY_ENABLED="${OPS_TELEMETRY_ENABLED:-true}"
export OPS_TELEMETRY_EVENTS_PATH
export OPS_TELEMETRY_BOARD_PATH
export OPS_TELEMETRY_SERVICE_NAME
export OPS_TELEMETRY_ENVIRONMENT
export OPS_TELEMETRY_STORE_PATH="${OPS_TELEMETRY_STORE_PATH:-/artifacts/ops-telemetry-events.ndjson}"
export OPS_TELEMETRY_MAX_EVENTS
export OPS_TELEMETRY_API_KEY
export OPS_TELEMETRY_API_KEY_HEADER
export OPS_TELEMETRY_API_KEY_PREFIX

ensure_docker

echo "Starting Test Engine + OPS telemetry stack..."
echo "QAira API base: $QAIRA_API_BASE_URL"
if [ -n "${RESOLVED_ENGINE_INTEGRATION_NAME:-}" ]; then
  echo "Active Test Engine integration: ${RESOLVED_ENGINE_INTEGRATION_NAME}"
fi
if [ -n "${RESOLVED_OPS_INTEGRATION_NAME:-}" ]; then
  echo "Active OPS integration: ${RESOLVED_OPS_INTEGRATION_NAME}"
fi
echo "Engine public URL: $ENGINE_PUBLIC_URL"
echo "OPS service label: $OPS_TELEMETRY_SERVICE_NAME"
echo "OPS environment: $OPS_TELEMETRY_ENVIRONMENT"
echo "OPS transport host: $PUBLIC_OPS_TRANSPORT_HOST"
echo "OPS event route: $PUBLIC_OPS_EVENTS_URL"
echo "OPS board route: $PUBLIC_OPS_BOARD_URL"
if [ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]; then
  echo "OPS OTLP endpoint: $OTEL_EXPORTER_OTLP_ENDPOINT"
else
  echo "OPS OTLP endpoint: not configured"
fi

if [ "$PULL_IMAGE" = "1" ]; then
  compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" pull testengine selenium-hub selenium-node-chrome
fi

compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" up -d testengine selenium-hub selenium-node-chrome
compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" ps

wait_for_url "$LOCAL_HEALTH_URL" "Test Engine health endpoint"
wait_for_url "$LOCAL_EVENTS_URL" "OPS telemetry event route"

echo
echo "Test Engine stack is running."
echo "Health: $LOCAL_HEALTH_URL"
echo "Capabilities: http://127.0.0.1:${TESTENGINE_PORT}/api/v1/capabilities"
echo "OPS events: $LOCAL_EVENTS_URL"
echo "OPS board: $LOCAL_BOARD_URL"
echo "Hosted OPS board: $PUBLIC_OPS_BOARD_URL"
