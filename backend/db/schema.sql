-- =========================
-- USERS & ROLES
-- =========================

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'local',
  google_sub TEXT UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id)
);

-- =========================
-- PROJECTS & ACCESS
-- =========================

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (role_id) REFERENCES roles(id),
  UNIQUE(project_id, user_id)
);

-- =========================
-- APP TYPES (DESIGN BOUNDARY)
-- =========================

CREATE TABLE app_types (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK(type IN ('web','api','android','ios','unified')),
  is_unified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- =========================
-- REQUIREMENTS
-- =========================

CREATE TABLE requirements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority INTEGER DEFAULT 3,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('llm','jira','email','google_auth')),
  name TEXT NOT NULL,
  base_url TEXT,
  api_key TEXT,
  model TEXT,
  project_key TEXT,
  username TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_verification_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('signup','password_reset')),
  code_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auth_verification_codes_lookup
  ON auth_verification_codes (email, purpose, created_at DESC);

-- =========================
-- TEST DESIGN
-- =========================

CREATE TABLE test_suites (
  id TEXT PRIMARY KEY,
  app_type_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id),
  FOREIGN KEY (parent_id) REFERENCES test_suites(id)
);

CREATE TABLE test_cases (
  id TEXT PRIMARY KEY,
  app_type_id TEXT,
  suite_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  priority INTEGER DEFAULT 3,
  status TEXT DEFAULT 'active',
  requirement_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id),
  FOREIGN KEY (suite_id) REFERENCES test_suites(id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id)
);

CREATE TABLE requirement_test_cases (
  requirement_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  PRIMARY KEY (requirement_id, test_case_id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
);

CREATE TABLE suite_test_cases (
  suite_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (suite_id, test_case_id),
  FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
);

CREATE TABLE test_steps (
  id TEXT PRIMARY KEY,
  test_case_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  action TEXT,
  expected_result TEXT,
  group_id TEXT,
  group_name TEXT,
  group_kind TEXT,
  reusable_group_id TEXT,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id)
);

CREATE TABLE shared_step_groups (
  id TEXT PRIMARY KEY,
  app_type_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id) ON DELETE CASCADE
);

CREATE INDEX idx_shared_step_groups_app_type
  ON shared_step_groups (app_type_id, updated_at DESC);

CREATE INDEX idx_test_steps_case_group
  ON test_steps (test_case_id, group_id, step_order);

CREATE TABLE test_environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  app_type_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  base_url TEXT,
  browser TEXT,
  notes TEXT,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id) ON DELETE CASCADE
);

CREATE INDEX idx_test_environments_project_scope
  ON test_environments (project_id, app_type_id);

CREATE TABLE test_configurations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  app_type_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  browser TEXT,
  mobile_os TEXT,
  platform_version TEXT,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id) ON DELETE CASCADE
);

CREATE INDEX idx_test_configurations_project_scope
  ON test_configurations (project_id, app_type_id);

CREATE TABLE test_data_sets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  app_type_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('key_value', 'table')),
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id) ON DELETE CASCADE
);

CREATE INDEX idx_test_data_sets_project_scope
  ON test_data_sets (project_id, app_type_id);

-- =========================
-- EXECUTION
-- =========================

CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  app_type_id TEXT,
  name TEXT,
  trigger TEXT CHECK(trigger IN ('manual','ci')),
  status TEXT CHECK(status IN ('queued','running','completed','failed')),
  test_environment_id TEXT,
  test_environment_name TEXT,
  test_environment_snapshot JSONB,
  test_configuration_id TEXT,
  test_configuration_name TEXT,
  test_configuration_snapshot JSONB,
  test_data_set_id TEXT,
  test_data_set_name TEXT,
  test_data_set_snapshot JSONB,
  created_by TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (app_type_id) REFERENCES app_types(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE execution_suites (
  execution_id TEXT NOT NULL,
  suite_id TEXT NOT NULL,
  suite_name TEXT,
  PRIMARY KEY (execution_id, suite_id),
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE TABLE execution_case_snapshots (
  execution_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  test_case_title TEXT NOT NULL,
  test_case_description TEXT,
  suite_id TEXT,
  suite_name TEXT,
  priority INTEGER,
  status TEXT,
  sort_order INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (execution_id, test_case_id),
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE TABLE execution_step_snapshots (
  execution_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  snapshot_step_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  action TEXT,
  expected_result TEXT,
  group_id TEXT,
  group_name TEXT,
  group_kind TEXT,
  reusable_group_id TEXT,
  PRIMARY KEY (execution_id, snapshot_step_id),
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE INDEX idx_execution_case_snapshots_execution_id
  ON execution_case_snapshots (execution_id, sort_order);

CREATE INDEX idx_execution_step_snapshots_execution_case
  ON execution_step_snapshots (execution_id, test_case_id, step_order);

CREATE TABLE execution_results (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  test_case_title TEXT,
  suite_id TEXT,
  suite_name TEXT,
  app_type_id TEXT NOT NULL,
  status TEXT CHECK(status IN ('passed','failed','blocked')),
  duration_ms INTEGER,
  error TEXT,
  logs TEXT,
  executed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (execution_id) REFERENCES executions(id),
  FOREIGN KEY (app_type_id) REFERENCES app_types(id),
  FOREIGN KEY (executed_by) REFERENCES users(id)
);
