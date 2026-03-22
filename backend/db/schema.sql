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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  is_unified BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE requirement_test_cases (
  requirement_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  PRIMARY KEY (requirement_id, test_case_id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
);

-- =========================
-- TEST DESIGN
-- =========================

CREATE TABLE test_suites (
  id TEXT PRIMARY KEY,
  app_type_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id),
  FOREIGN KEY (suite_id) REFERENCES test_suites(id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id)
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
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id)
);

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
  created_by TEXT,
  started_at DATETIME,
  ended_at DATETIME,
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (execution_id) REFERENCES executions(id),
  FOREIGN KEY (app_type_id) REFERENCES app_types(id),
  FOREIGN KEY (executed_by) REFERENCES users(id)
);
