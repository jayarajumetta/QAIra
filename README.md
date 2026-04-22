# QAIra

QAIra is a QA management workspace with a Fastify backend, a React frontend, and PostgreSQL for persistence.

This repo is now PostgreSQL-first. SQLite is no longer part of the runtime, which avoids the read-only database file issues that were happening with mounted `.db` files.

## Stack

- Backend: Fastify on Node.js
- Frontend: React + Vite
- Database: PostgreSQL 16
- Containers: Docker Compose

## Repo layout

- `backend/api`: Fastify API
- `backend/db/schema.sql`: PostgreSQL schema loaded on first database boot
- `backend/db/seed.sql`: sample data loaded on first database boot
- `backend/docker-compose.yml`: backend + PostgreSQL only
- `docker-compose.full.yml`: full stack with PostgreSQL, API, and frontend
- `docker-compose.platform.yml`: full stack plus HAProxy, Prometheus, Grafana, Loki, Promtail, and OpenTelemetry Collector
- `frontend`: React app
- `testengine`: standalone Playwright worker plane
- `openapi.yaml`: API contract

## Quick start: full stack

1. Pull the PostgreSQL image:

```bash
docker pull postgres:16-alpine
```

2. Start everything from the repo root:

```bash
docker compose -f docker-compose.full.yml pull
docker compose -f docker-compose.full.yml up -d
```

3. Open the apps:

- Frontend: `http://localhost:8080`
- API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`

On the first boot, the Postgres container creates the `qaira` database and automatically runs:

- `backend/db/schema.sql`
- `backend/db/seed.sql`

## Release script

Use the root release script to build amd64 backend/frontend/Test Engine images, push them to Docker Hub, and refresh the running stack:

```bash
./release.sh
```

Useful variants:

```bash
IMAGE_TAG=v1.0.0 ./release.sh
DOCKER_NAMESPACE=your-dockerhub-user ./release.sh
./release.sh --no-deploy
./release.sh --deploy-testengine-local
```

`release.sh` now builds and pushes three images:

- QAira backend
- QAira frontend
- QAira Test Engine

For a separate Test Engine EC2 host, use:

```bash
./release-testengine.sh
```

## Quick start: backend only

Run the backend and PostgreSQL without the frontend:

```bash
cd backend
docker pull postgres:16-alpine
docker compose up --build
```

You can also use:

```bash
cd backend
./start.sh
```

The API will be available at `http://localhost:3000`.

## Start individual services

From the repo root:

```bash
./run-postgres.sh
./run-backend.sh
./run-frontend.sh
./run-testengine.sh
```

By default these scripts reuse the local image reference already configured in Compose. Set `PULL_IMAGES=1` when you want them to pull published images first.

## Platform stack

For the stronger Docker edge and observability layer:

```bash
docker compose -f docker-compose.platform.yml up -d
```

That stack adds:

- HAProxy on `http://localhost`
- Prometheus on `http://localhost:9090`
- Grafana on `http://localhost:3001`
- Loki on `http://localhost:3100`
- HAProxy stats on `http://localhost:8404/stats`

More detail is in [PLATFORM_STACK.md](./PLATFORM_STACK.md).

## Manual PostgreSQL setup

If you want to run Postgres yourself instead of using Compose, these are the explicit steps.

1. Pull the image:

```bash
docker pull postgres:16-alpine
```

2. Start PostgreSQL:

```bash
docker run --name qaira-postgres \
  -e POSTGRES_DB=qaira \
  -e POSTGRES_USER=qaira \
  -e POSTGRES_PASSWORD=qaira \
  -p 5432:5432 \
  -d postgres:16-alpine
```

3. Load the schema:

```bash
PGPASSWORD=qaira psql -h localhost -U qaira -d qaira -f backend/db/schema.sql
```

4. Load the sample data:

```bash
PGPASSWORD=qaira psql -h localhost -U qaira -d qaira -f backend/db/seed.sql
```

5. Run the API locally:

```bash
cd backend/api
npm install
DATABASE_URL=postgresql://qaira:qaira@localhost:5432/qaira npm start
```

6. Run the frontend locally in another terminal:

```bash
cd frontend
npm install
VITE_API_BASE_URL=http://localhost:3000 npm run dev
```

## Sample login

The seed file creates these users:

- `admin@testiny.ai` / `admin123`
- `member@testiny.ai` / `member123`

## Environment variables

### Backend

- `DATABASE_URL`
  Example: `postgresql://qaira:qaira@postgres:5432/qaira`
- `SESSION_SECRET`
- `CORS_ORIGIN`
- `LOG_LEVEL`

### PostgreSQL container

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

### Frontend

- `QAIRA_API_BASE_URL` for the container build/runtime config
- `VITE_API_BASE_URL` for local Vite development
- `QAIRA_BACKEND_IMAGE` to override the backend Docker Hub image
- `QAIRA_FRONTEND_IMAGE` to override the frontend Docker Hub image

## Database behavior

- The official `postgres:16-alpine` image creates the database defined by `POSTGRES_DB`.
- The mounted SQL files in `backend/db` are executed only when the Postgres data directory is empty.
- Sample data is inserted from `backend/db/seed.sql`, so the backend and frontend have working starter content immediately.

## Reset the database

If you want a fresh database and fresh seed data:

From the repo root:

```bash
docker compose -f docker-compose.full.yml down -v
docker compose -f docker-compose.full.yml pull
docker compose -f docker-compose.full.yml up -d
```

From the backend folder:

```bash
docker compose down -v
docker compose up --build
```

## Notes

- `docker-compose.full.yml` now uses Docker Hub images by default:
- Backend: `jayarajumetta/qaira-backend:latest`
- Frontend: `jayarajumetta/qaira-frontend:latest`
- The frontend is configured to talk to `http://localhost:3000` by default in local Docker workflows.
- The schema in `backend/db/schema.sql` is ordered for PostgreSQL foreign key creation, and `seed.sql` uses PostgreSQL boolean values.
