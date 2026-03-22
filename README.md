# QAIra

QAIra is a Fastify + SQLite backend for QA project management. The API follows a simple pattern:

- route modules define HTTP endpoints and input validation
- service modules contain CRUD logic and relational checks
- SQLite is the source of truth for the domain model
- `frontend/` provides a React + TypeScript workspace UI bound to the API

## Repository Layout

- `backend/api`: Fastify API server
- `backend/db`: SQLite schema and seed SQL
- `backend/data`: SQLite database file
- `backend/docker-compose.yml`: local container orchestration for DB init + API
- `frontend`: Vite + React application for signup, login, session restoration, and resource management

## Database Model

Current application tables in SQLite:

- `users`
- `roles`
- `projects`
- `project_members`
- `app_types`
- `requirements`
- `test_suites`
- `test_cases`
- `test_steps`
- `executions`
- `execution_results`

Schema source: [backend/db/schema.sql](/Users/jayarajumetta/MJ/qaira/backend/db/schema.sql)

Seed data source: [backend/db/seed.sql](/Users/jayarajumetta/MJ/qaira/backend/db/seed.sql)

## API Coverage

Implemented CRUD resources:

- `auth`
- `users`
- `roles`
- `projects`
- `project-members`
- `app-types`
- `requirements`
- `test-suites`
- `test-cases`
- `test-steps`
- `executions`
- `execution-results`

Main route registration lives in [backend/api/src/routes/index.js](/Users/jayarajumetta/MJ/qaira/backend/api/src/routes/index.js).

Machine-readable API spec: [openapi.yaml](/Users/jayarajumetta/MJ/qaira/openapi.yaml)

Frontend entrypoint: [frontend/src/App.tsx](/Users/jayarajumetta/MJ/qaira/frontend/src/App.tsx)
Frontend container build: [frontend/Dockerfile](/Users/jayarajumetta/MJ/qaira/frontend/Dockerfile)

## API Endpoints

### Auth

- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/session`

Body fields:

- `email` required for signup and login
- `password` required for signup and login
- `name` optional for signup

### Users

- `POST /users`
- `GET /users`
- `GET /users/:id`
- `PUT /users/:id`
- `DELETE /users/:id`

Body fields:

- `email` required
- `password_hash` required
- `name` optional

### Roles

- `POST /roles`
- `GET /roles`
- `GET /roles/:id`
- `PUT /roles/:id`
- `DELETE /roles/:id`

Body fields:

- `name` required

### Projects

- `POST /projects`
- `GET /projects`
- `GET /projects/:id`
- `PUT /projects/:id`
- `DELETE /projects/:id`

Body fields:

- `name` required
- `description` optional
- `created_by` required on create

### Project Members

- `POST /project-members`
- `GET /project-members`
- `GET /project-members/:id`
- `PUT /project-members/:id`
- `DELETE /project-members/:id`

Query filters:

- `project_id`
- `user_id`
- `role_id`

Body fields:

- `project_id` required on create
- `user_id` required on create
- `role_id` required on create

### App Types

- `POST /app-types`
- `GET /app-types`
- `GET /app-types/:id`
- `PUT /app-types/:id`
- `DELETE /app-types/:id`

Query filters:

- `project_id`

Body fields:

- `project_id` required on create
- `name` required on create
- `type` required on create: `web`, `api`, `android`, `ios`, `unified`
- `is_unified` optional

### Requirements

- `POST /requirements`
- `GET /requirements`
- `GET /requirements/:id`
- `PUT /requirements/:id`
- `DELETE /requirements/:id`

Query filters:

- `project_id`
- `status`
- `priority`

Body fields:

- `project_id` required on create
- `title` required on create
- `description` optional
- `priority` optional
- `status` optional

### Test Suites

- `POST /test-suites`
- `GET /test-suites`
- `GET /test-suites/:id`
- `PUT /test-suites/:id`
- `DELETE /test-suites/:id`

Query filters:

- `app_type_id`
- `parent_id`

Body fields:

- `app_type_id` required on create
- `name` required on create
- `parent_id` optional

### Test Cases

- `POST /test-cases`
- `GET /test-cases`
- `GET /test-cases/:id`
- `PUT /test-cases/:id`
- `DELETE /test-cases/:id`

Query filters:

- `suite_id`
- `requirement_id`
- `status`

Body fields:

- `suite_id` required on create
- `title` required on create
- `description` optional
- `priority` optional
- `status` optional
- `requirement_id` optional

### Test Steps

- `POST /test-steps`
- `GET /test-steps`
- `GET /test-steps/:id`
- `PUT /test-steps/:id`
- `DELETE /test-steps/:id`

Query filters:

- `test_case_id`

Body fields:

- `test_case_id` required on create
- `step_order` required on create
- `action` optional
- `expected_result` optional

### Executions

- `POST /executions`
- `GET /executions`
- `GET /executions/:id`
- `POST /executions/:id/start`
- `POST /executions/:id/complete`
- `DELETE /executions/:id`

Query filters:

- `project_id`
- `status`

Body fields:

- `project_id` required on create
- `name` optional
- `created_by` required on create
- `status` required for complete: `completed`, `failed`

### Execution Results

- `POST /execution-results`
- `GET /execution-results`
- `GET /execution-results/:id`
- `PUT /execution-results/:id`
- `DELETE /execution-results/:id`

Query filters:

- `execution_id`
- `test_case_id`
- `app_type_id`

Body fields:

- `execution_id` required on create
- `test_case_id` required on create
- `app_type_id` required on create
- `status` required on create: `passed`, `failed`, `blocked`
- `duration_ms` optional
- `error` optional
- `logs` optional
- `executed_by` optional

## Run The Database

### Quick Start From Backend Folder

Use the backend-local entrypoint script:

```bash
cd backend
./start.sh
```

This wraps the existing Compose setup in [backend/docker-compose.yml](/Users/jayarajumetta/MJ/qaira/backend/docker-compose.yml).

To exercise the API end-to-end with sample data and example CRUD calls:

```bash
./demo-api.sh
```

Requirements for the demo script:

- API must already be running on `http://localhost:3000`
- `curl` must be installed
- `jq` must be installed

### Option 1: Docker Compose

From the repository root:

```bash
cd backend
docker compose up --build
```

What this does:

- starts the DB init container from [backend/Dockerfile](/Users/jayarajumetta/MJ/qaira/backend/Dockerfile)
- creates `/data/testiny.db`
- loads schema from `backend/db/schema.sql`
- loads seed data from `backend/db/seed.sql`
- starts the API on `http://localhost:3000`

### Option 2: Local SQLite

Create or recreate the database manually:

```bash
sqlite3 backend/data/testiny.db < backend/db/schema.sql
sqlite3 backend/data/testiny.db < backend/db/seed.sql
```

Inspect the database:

```bash
sqlite3 backend/data/testiny.db
```

Example SQLite commands:

```sql
.tables
SELECT * FROM projects;
SELECT * FROM app_types;
SELECT * FROM test_cases;
```

## Run The API

Install dependencies and start the server:

```bash
cd backend/api
npm install
DB_PATH=../data/testiny.db npm start
```

If you run the API from the repo root instead, use an absolute DB path or point `DB_PATH` to `backend/data/testiny.db`.

API entrypoints:

- [backend/api/src/server.js](/Users/jayarajumetta/MJ/qaira/backend/api/src/server.js)
- [backend/api/src/app.js](/Users/jayarajumetta/MJ/qaira/backend/api/src/app.js)

Session notes:

- auth endpoints now issue a signed bearer token
- `GET /auth/session` expects `Authorization: Bearer <token>`
- set `SESSION_SECRET` in the API environment for anything beyond local development

## Run The Frontend

Install dependencies and start the web app:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend defaults:

- app URL: `http://localhost:5173`
- API base URL: `http://localhost:3000`
- override the API target with `VITE_API_BASE_URL`

What the frontend includes:

- signup, login, logout, and session restoration
- overview dashboard
- people and roles management
- project, membership, app-type, and requirement management
- test suite, case, and step management
- execution and execution-result management

## Run The Frontend In Docker

Frontend-only container:

```bash
cd frontend
./start.sh
```

Frontend default URL:

- `http://localhost:8080`

Override the backend target at runtime:

```bash
cd frontend
QAIRA_API_BASE_URL=http://192.168.1.25:3000 ./start.sh
```

This runtime variable is injected when the container starts, so the same frontend image can point to different backend machines.

## Run Full Stack With One Compose File

From the repo root:

```bash
docker compose -f docker-compose.full.yml up --build
```

This starts:

- SQLite DB initializer
- Fastify API on `http://localhost:3000`
- Frontend on `http://localhost:8080`

If frontend and backend run on different machines:

1. Start backend on the API host and ensure port `3000` is reachable.
2. Start frontend on the UI host with `QAIRA_API_BASE_URL` set to the backend machine URL.

Example:

```bash
cd frontend
QAIRA_API_BASE_URL=http://10.0.0.15:3000 docker compose up --build
```

Note:

- if the backend is remote, ensure port `3000` is reachable and set `CORS_ORIGIN` on the API if you want to restrict which frontend origins may call it
- set `SESSION_SECRET` for the API in non-local environments

## Notes On Behavior

- The API enforces relational checks in services before delete operations where dependent records exist.
- Validation is lightweight and implemented in [backend/api/src/plugins/validator.js](/Users/jayarajumetta/MJ/qaira/backend/api/src/plugins/validator.js).
- Error responses are handled centrally in [backend/api/src/plugins/errorHandler.js](/Users/jayarajumetta/MJ/qaira/backend/api/src/plugins/errorHandler.js).


##  Step 1: Rebuild
cd backend
docker build --no-cache --platform linux/amd64 -t jayarajumetta/qaira-backend:latest .
docker push jayarajumetta/qaira-backend:latest
## Step 2: Redeploy EC2
docker compose -f docker-compose.full.yml down
docker rmi jayarajumetta/qaira-backend:latest
docker compose -f docker-compose.full.yml up -d
## 🔍 Step 3: Verify logs
docker logs testiny-api

👉 Now you should see:

Initializing SQLite DB...
Database initialized...
Starting API server...
Server running on port 3000