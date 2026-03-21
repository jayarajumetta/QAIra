# QAIra

QAIra is a Fastify + SQLite backend for QA project management. The API follows a simple pattern:

- route modules define HTTP endpoints and input validation
- service modules contain CRUD logic and relational checks
- SQLite is the source of truth for the domain model

## Repository Layout

- `backend/api`: Fastify API server
- `backend/db`: SQLite schema and seed SQL
- `backend/data`: SQLite database file
- `backend/docker-compose.yml`: local container orchestration for DB init + API

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

## API Endpoints

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

## Notes On Behavior

- The API enforces relational checks in services before delete operations where dependent records exist.
- Validation is lightweight and implemented in [backend/api/src/plugins/validator.js](/Users/jayarajumetta/MJ/qaira/backend/api/src/plugins/validator.js).
- Error responses are handled centrally in [backend/api/src/plugins/errorHandler.js](/Users/jayarajumetta/MJ/qaira/backend/api/src/plugins/errorHandler.js).
