#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/scripts/docker-common.sh"

usage() {
  cat <<EOF
Usage: ./deploy-ec2.sh [options]

Pulls the latest repo changes on an EC2 host and refreshes the selected
Docker Compose stack using published images.

Options:
  --stack <full|platform|testengine>
                        Stack to refresh. Default: full
  --branch <name>       Git branch to pull. Default: current branch
  --skip-git-pull       Reuse the current repo checkout without git pull
  --skip-image-pull     Reuse locally cached images without docker compose pull
  --help                Show this help message.

Environment variables:
  BRANCH                Git branch override
  QAIRA_BACKEND_IMAGE   Backend image override for full/platform stacks
  QAIRA_FRONTEND_IMAGE  Frontend image override for full/platform stacks
  QAIRA_TESTENGINE_IMAGE Test Engine image override for the testengine stack
  TESTENGINE_PORT       Host port for the Test Engine stack. Default: 4301

Examples:
  ./deploy-ec2.sh
  ./deploy-ec2.sh --stack platform
  ./deploy-ec2.sh --stack testengine
  BRANCH=main ./deploy-ec2.sh
  ./deploy-ec2.sh --skip-git-pull
EOF
}

STACK="${STACK:-full}"
SKIP_GIT_PULL=0
SKIP_IMAGE_PULL=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --stack)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --stack"
        exit 1
      fi
      STACK="$2"
      shift
      ;;
    --branch)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --branch"
        exit 1
      fi
      BRANCH="$2"
      shift
      ;;
    --skip-git-pull)
      SKIP_GIT_PULL=1
      ;;
    --skip-image-pull)
      SKIP_IMAGE_PULL=1
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

ensure_docker

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required but was not found in PATH."
  exit 1
fi

CURRENT_BRANCH="$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

if [ -z "$CURRENT_BRANCH" ] || [ "$CURRENT_BRANCH" = "HEAD" ]; then
  CURRENT_BRANCH="main"
fi

BRANCH="${BRANCH:-$CURRENT_BRANCH}"

case "$STACK" in
  full)
    COMPOSE_FILE="$SCRIPT_DIR/docker-compose.full.yml"
    ;;
  platform)
    COMPOSE_FILE="$SCRIPT_DIR/docker-compose.platform.yml"
    ;;
  testengine)
    COMPOSE_FILE="$SCRIPT_DIR/testengine/docker-compose.deploy.yml"
    ;;
  *)
    echo "Unsupported stack: $STACK"
    echo "Expected one of: full, platform, testengine"
    exit 1
    ;;
esac

echo "Deploying QAira on EC2"
echo "Root: $SCRIPT_DIR"
echo "Stack: $STACK"
echo "Branch: $BRANCH"
echo "Compose file: $COMPOSE_FILE"

if [ "$SKIP_GIT_PULL" = "0" ]; then
  echo
  echo "Fetching latest repo changes..."
  git -C "$SCRIPT_DIR" fetch origin "$BRANCH"

  echo
  echo "Pulling latest branch changes..."
  git -C "$SCRIPT_DIR" pull --ff-only origin "$BRANCH"
fi

if [ "$SKIP_IMAGE_PULL" = "0" ]; then
  echo
  echo "Pulling published Docker images..."
  QAIRA_BACKEND_IMAGE="${QAIRA_BACKEND_IMAGE:-jayarajumetta/qaira-backend:latest}" \
  QAIRA_FRONTEND_IMAGE="${QAIRA_FRONTEND_IMAGE:-jayarajumetta/qaira-frontend:latest}" \
  QAIRA_TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-jayarajumetta/qaira-testengine:latest}" \
    compose_cmd -f "$COMPOSE_FILE" pull
fi

echo
echo "Refreshing containers..."
QAIRA_BACKEND_IMAGE="${QAIRA_BACKEND_IMAGE:-jayarajumetta/qaira-backend:latest}" \
QAIRA_FRONTEND_IMAGE="${QAIRA_FRONTEND_IMAGE:-jayarajumetta/qaira-frontend:latest}" \
QAIRA_TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-jayarajumetta/qaira-testengine:latest}" \
  compose_cmd -f "$COMPOSE_FILE" up -d --force-recreate

echo
echo "Current stack status:"
QAIRA_BACKEND_IMAGE="${QAIRA_BACKEND_IMAGE:-jayarajumetta/qaira-backend:latest}" \
QAIRA_FRONTEND_IMAGE="${QAIRA_FRONTEND_IMAGE:-jayarajumetta/qaira-frontend:latest}" \
QAIRA_TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-jayarajumetta/qaira-testengine:latest}" \
  compose_cmd -f "$COMPOSE_FILE" ps

echo
echo "EC2 deployment complete."
