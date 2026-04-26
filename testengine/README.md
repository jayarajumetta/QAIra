# QAira Test Engine

`testengine/` is a backend-only Playwright execution plane for QAira. QAira remains the only frontend, the only operator surface, and the system of record for authoring, runs, evidence history, and review.

There should not be a second UI here. The right split is:

- QAira frontend and backend: control plane
- Test Engine: scalable Docker worker plane

## Why This Exists

QAira already owns:

- requirements, suites, test cases, shared steps, environments, and data
- run creation and run status
- case snapshots and step snapshots
- manual result review and preserved history

What QAira does not yet own is an isolated Playwright runtime that can:

- execute browser and API automation inside Docker
- scale independently from the main app
- reuse attached automation scripts on repeat runs
- attempt constrained self-healing on failure
- emit artifact bundles without bloating the core app server

That belongs in a separate backend service, not a separate product frontend.

## Product Boundary

QAira control plane:

- user clicks Run from the existing QAira UI
- QAira creates the run with `/executions`
- QAira snapshots cases, steps, environment, configuration, and data
- QAira hands automated cases to Test Engine
- QAira records run status, case result, and evidence history
- QAira remains the review surface for promoted healing patches

Test Engine worker plane:

- accepts automated case handoff requests from QAira
- resolves attached script versus manual handover generation
- executes Playwright deterministically first
- performs constrained repair only after failure
- captures trace, screenshots, console, network, DOM, and summary artifacts
- calls back into QAira with case result and step evidence payloads

## Current QAira API Mapping

QAira already has the core APIs needed to make this work:

- `POST /executions`
  - open a run from QAira
- `POST /executions/:id/start`
  - mark the run as active when engine processing begins
- `GET /executions/:id`
  - fetch the snapped cases and snapped steps for the run
- `POST /execution-results`
  - create the first case result record
- `PUT /execution-results/:id`
  - update the case result as more step data arrives
- `POST /executions/:id/complete`
  - finish the run after all automated cases settle

The important compatibility detail is that QAira already stores step-level statuses, notes, and image evidence inside `execution_results.logs` as structured JSON. Test Engine should use that shape first instead of inventing a second evidence model for the first integration pass.

## Evidence Strategy

Near-term compatibility path:

- inline step status in `logs.stepStatuses`
- inline step notes in `logs.stepNotes`
- inline step screenshot preview in `logs.stepEvidence`
- case status and duration in `execution_results`

Scale path for larger artifacts:

- keep full trace, HAR, video, DOM, and console bundles in Test Engine artifact storage
- send QAira a manifest plus an optional preview image per failed step
- add a dedicated QAira artifact table later when we need durable large-object storage

## Core Decisions

- Runtime: Playwright only
- Primary language: TypeScript
- Packaging: Docker only
- Execution policy: deterministic first, AI fallback second
- Healing scope: locator, wait, popup, navigation recovery
- Assertion policy: business assertions never change silently
- Review policy: healed patches are proposed to QAira before promotion

## Folder Layout

```text
testengine/
  backend/
    src/
      contracts/
      lib/
      server.ts
    Dockerfile
    package.json
    tsconfig.json
  docker-compose.yml
  ARCHITECTURE.md
```

## Running In Docker

The Playwright engine already has a separate Docker image definition at `testengine/backend/Dockerfile`.

Build and run it directly:

```bash
docker build -f testengine/backend/Dockerfile -t qaira-testengine ./testengine/backend
docker run --rm -p 4301:4301 -e PORT=4301 -e ARTIFACT_ROOT=/artifacts qaira-testengine
```

Or use Compose for local source builds:

```bash
docker compose -f testengine/docker-compose.yml up --build
```

For a standalone image-based host deployment, use:

```bash
docker compose -f testengine/docker-compose.deploy.yml pull
docker compose -f testengine/docker-compose.deploy.yml up -d
```

Or from the repo root:

```bash
./run-testengine.sh
./start-testengine-ops.sh
./release-testengine.sh
```

For a separate Test Engine host that should also align its OPS settings with the
active QAira integrations and expose the local telemetry board on the same host,
prefer:

```bash
QAIRA_API_BASE_URL=https://qaira.qualipal.in/api \
QAIRA_TESTENGINE_SECRET=replace-with-your-shared-secret \
QAIRA_AUTH_TOKEN=replace-with-a-qaira-token \
QAIRA_PROJECT_ID=replace-with-project-id \
./start-testengine-ops.sh
```

If you do not want integration lookup, set `ENGINE_PUBLIC_URL` directly instead.
When the stack is up, the Test Engine host serves:

- `GET /health`
- `GET /api/v1/capabilities`
- `GET /api/v1/events`
- `POST /api/v1/events`
- `GET /ops-telemetry`

The `/ops-telemetry` board lets operators filter captured execution hierarchy
events by `service_name`, status, event type, and execution identifiers.

On Apple Silicon or other ARM64 hosts, QAira defaults the Selenium browser node to
`selenium/node-chromium:4.22.0` because Selenium's official Chrome node images are
AMD64-only. If you want to override the Grid images explicitly, set:

```bash
QAIRA_SELENIUM_HUB_IMAGE=selenium/hub:4.22.0 \
QAIRA_SELENIUM_NODE_IMAGE=selenium/node-chromium:4.22.0 \
./run-testengine.sh
```

On an AMD64 host, you can opt back into Chrome with:

```bash
QAIRA_SELENIUM_NODE_IMAGE=selenium/node-chrome:4.22.0 ./run-testengine.sh
```

## See Also

- [QAira background operations strategy](../QAIRA_BACKGROUND_OPERATIONS_STRATEGY.md)
- [QAira product operating model](../QAIRA_PRODUCT_OPERATING_MODEL.md)
- [Architecture](./ARCHITECTURE.md)
- [QAira handoff contract](./backend/src/contracts/qaira.ts)
