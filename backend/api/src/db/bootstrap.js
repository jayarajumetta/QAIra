const db = require("./index");
const {
  INTEGRATION_TYPE_VALUES
} = require("../domain/catalog");

let bootstrapPromise = null;

const sqlEnum = (values) => values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(", ");

const statements = [
  `
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
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
    )
  `,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS type TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS base_url TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS api_key TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS model TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS project_key TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS username TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_type_check`,
  `ALTER TABLE integrations ADD CONSTRAINT integrations_type_check CHECK (type IN (${sqlEnum(INTEGRATION_TYPE_VALUES)}))`,
  `CREATE INDEX IF NOT EXISTS idx_integrations_type_active ON integrations (type, is_active)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data_url TEXT`,
  `UPDATE users SET auth_provider = 'local' WHERE auth_provider IS NULL OR TRIM(auth_provider) = ''`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub_unique ON users (google_sub) WHERE google_sub IS NOT NULL`,
  `
    CREATE TABLE IF NOT EXISTS auth_verification_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS purpose TEXT`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS code_hash TEXT`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE auth_verification_codes DROP CONSTRAINT IF EXISTS auth_verification_codes_purpose_check`,
  `ALTER TABLE auth_verification_codes ADD CONSTRAINT auth_verification_codes_purpose_check CHECK (purpose IN ('signup', 'password_reset'))`,
  `CREATE INDEX IF NOT EXISTS idx_auth_verification_codes_lookup ON auth_verification_codes (email, purpose, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS test_environments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      base_url TEXT,
      browser TEXT,
      notes TEXT,
      variables JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS base_url TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS browser TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS notes TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_test_environments_project_scope ON test_environments (project_id, app_type_id)`,
  `
    CREATE TABLE IF NOT EXISTS test_configurations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      browser TEXT,
      mobile_os TEXT,
      platform_version TEXT,
      variables JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS browser TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS mobile_os TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS platform_version TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_test_configurations_project_scope ON test_configurations (project_id, app_type_id)`,
  `
    CREATE TABLE IF NOT EXISTS test_data_sets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      mode TEXT NOT NULL DEFAULT 'key_value',
      columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      rows JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'key_value'`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS columns JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS rows JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_test_data_sets_project_scope ON test_data_sets (project_id, app_type_id)`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_environment_id TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_environment_name TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_environment_snapshot JSONB`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_configuration_id TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_configuration_name TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_configuration_snapshot JSONB`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_data_set_id TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_data_set_name TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_data_set_snapshot JSONB`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS assigned_to TEXT`,
  `
    CREATE TABLE IF NOT EXISTS execution_schedules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      name TEXT NOT NULL,
      cadence TEXT NOT NULL DEFAULT 'once',
      next_run_at TIMESTAMPTZ,
      last_run_at TIMESTAMPTZ,
      suite_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      test_case_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      test_environment_id TEXT,
      test_configuration_id TEXT,
      test_data_set_id TEXT,
      assigned_to TEXT,
      created_by TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS cadence TEXT NOT NULL DEFAULT 'once'`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS suite_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS test_case_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS test_environment_id TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS test_configuration_id TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS test_data_set_id TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS assigned_to TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `
    CREATE TABLE IF NOT EXISTS ai_test_case_generation_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT NOT NULL,
      integration_id TEXT,
      requirement_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      max_cases_per_requirement INTEGER NOT NULL DEFAULT 8,
      parallel_requirement_limit INTEGER NOT NULL DEFAULT 1,
      additional_context TEXT,
      external_links JSONB NOT NULL DEFAULT '[]'::jsonb,
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'queued',
      total_requirements INTEGER NOT NULL DEFAULT 0,
      processed_requirements INTEGER NOT NULL DEFAULT 0,
      generated_cases_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS integration_id TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS requirement_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS max_cases_per_requirement INTEGER NOT NULL DEFAULT 8`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS parallel_requirement_limit INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS additional_context TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS external_links JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS total_requirements INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS processed_requirements INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS generated_cases_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS error TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE ai_test_case_generation_jobs DROP CONSTRAINT IF EXISTS ai_test_case_generation_jobs_status_check`,
  `ALTER TABLE ai_test_case_generation_jobs ADD CONSTRAINT ai_test_case_generation_jobs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))`,
  `
    CREATE TABLE IF NOT EXISTS execution_case_snapshots (
      execution_id TEXT NOT NULL,
      test_case_id TEXT NOT NULL,
      test_case_title TEXT NOT NULL,
      test_case_description TEXT,
      suite_id TEXT,
      suite_name TEXT,
      priority INTEGER,
      status TEXT,
      parameter_values JSONB NOT NULL DEFAULT '{}'::jsonb,
      sort_order INTEGER NOT NULL DEFAULT 1,
      assigned_to TEXT,
      PRIMARY KEY (execution_id, test_case_id)
    )
  `,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS parameter_values JSONB`,
  `UPDATE execution_case_snapshots SET parameter_values = '{}'::jsonb WHERE parameter_values IS NULL`,
  `ALTER TABLE execution_case_snapshots ALTER COLUMN parameter_values SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE execution_case_snapshots ALTER COLUMN parameter_values SET NOT NULL`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS assigned_to TEXT`,
  `
    CREATE TABLE IF NOT EXISTS execution_step_snapshots (
      execution_id TEXT NOT NULL,
      test_case_id TEXT NOT NULL,
      snapshot_step_id TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      action TEXT,
      expected_result TEXT,
      PRIMARY KEY (execution_id, snapshot_step_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS shared_step_groups (
      id TEXT PRIMARY KEY,
      app_type_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS step_type TEXT`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS automation_code TEXT`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS api_request JSONB`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS group_id TEXT`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS group_name TEXT`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS group_kind TEXT`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS reusable_group_id TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS step_type TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS automation_code TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS api_request JSONB`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS group_id TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS group_name TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS group_kind TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS reusable_group_id TEXT`,
  `
    UPDATE test_steps
    SET step_type = CASE
      WHEN LOWER(COALESCE(BTRIM(test_steps.step_type), '')) IN ('web', 'api', 'android', 'ios') THEN LOWER(BTRIM(test_steps.step_type))
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'api' THEN 'api'
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'android' THEN 'android'
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'ios' THEN 'ios'
      ELSE 'web'
    END
    FROM test_cases
    LEFT JOIN app_types ON app_types.id = test_cases.app_type_id
    WHERE test_steps.test_case_id = test_cases.id
      AND (
        test_steps.step_type IS NULL
        OR BTRIM(test_steps.step_type) = ''
        OR LOWER(BTRIM(test_steps.step_type)) NOT IN ('web', 'api', 'android', 'ios')
      )
  `,
  `
    UPDATE execution_step_snapshots
    SET step_type = CASE
      WHEN LOWER(COALESCE(BTRIM(execution_step_snapshots.step_type), '')) IN ('web', 'api', 'android', 'ios') THEN LOWER(BTRIM(execution_step_snapshots.step_type))
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'api' THEN 'api'
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'android' THEN 'android'
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'ios' THEN 'ios'
      ELSE 'web'
    END
    FROM test_cases
    LEFT JOIN app_types ON app_types.id = test_cases.app_type_id
    WHERE execution_step_snapshots.test_case_id = test_cases.id
      AND (
        execution_step_snapshots.step_type IS NULL
        OR BTRIM(execution_step_snapshots.step_type) = ''
        OR LOWER(BTRIM(execution_step_snapshots.step_type)) NOT IN ('web', 'api', 'android', 'ios')
      )
  `,
  `CREATE INDEX IF NOT EXISTS idx_execution_case_snapshots_execution_id ON execution_case_snapshots (execution_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_step_snapshots_execution_case ON execution_step_snapshots (execution_id, test_case_id, step_order)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_schedules_project_next_run ON execution_schedules (project_id, next_run_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_shared_step_groups_app_type ON shared_step_groups (app_type_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_test_steps_case_group ON test_steps (test_case_id, group_id, step_order)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_execution_created_at ON execution_results (execution_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_case_created_at ON execution_results (test_case_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_app_type_created_at ON execution_results (app_type_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_suite_test_cases_test_case_sort ON suite_test_cases (test_case_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_test_cases_test_case ON requirement_test_cases (test_case_id)`,
  `CREATE INDEX IF NOT EXISTS idx_project_members_project_user ON project_members (project_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_suites_execution_suite ON execution_suites (execution_id, suite_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_scope_status ON ai_test_case_generation_jobs (app_type_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_project_created ON ai_test_case_generation_jobs (project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_test_cases_app_status_created ON test_cases (app_type_id, status, created_at DESC)`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS parameter_values JSONB`,
  `UPDATE test_cases SET parameter_values = '{}'::jsonb WHERE parameter_values IS NULL`,
  `ALTER TABLE test_cases ALTER COLUMN parameter_values SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE test_cases ALTER COLUMN parameter_values SET NOT NULL`,
  `
    UPDATE execution_case_snapshots
    SET parameter_values = COALESCE(test_cases.parameter_values, '{}'::jsonb)
    FROM test_cases
    WHERE execution_case_snapshots.test_case_id = test_cases.id
      AND (execution_case_snapshots.parameter_values IS NULL OR execution_case_snapshots.parameter_values = '{}'::jsonb)
  `,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS automated TEXT NOT NULL DEFAULT 'no'`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generation_source TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generation_review_status TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generation_job_id TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generated_at TIMESTAMPTZ`,
  `
    UPDATE test_cases
    SET automated = CASE
      WHEN automated IS NULL OR BTRIM(automated) = '' THEN 'no'
      WHEN LOWER(BTRIM(automated)) IN ('yes', 'y', 'true', '1') THEN 'yes'
      ELSE 'no'
    END
  `,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_automated_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_automated_check CHECK (automated IN ('yes', 'no'))`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_ai_generation_source_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_ai_generation_source_check CHECK (ai_generation_source IS NULL OR ai_generation_source IN ('scheduler'))`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_ai_generation_review_status_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_ai_generation_review_status_check CHECK (ai_generation_review_status IS NULL OR ai_generation_review_status IN ('pending', 'accepted'))`,
  `CREATE INDEX IF NOT EXISTS idx_test_cases_ai_generation_review ON test_cases (app_type_id, ai_generation_source, ai_generation_review_status, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS workspace_transactions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      app_type_id TEXT,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      title TEXT NOT NULL,
      description TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      related_kind TEXT,
      related_id TEXT,
      created_by TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS category TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS action TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS title TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS related_kind TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS related_id TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE workspace_transactions SET category = 'general' WHERE category IS NULL OR BTRIM(category) = ''`,
  `UPDATE workspace_transactions SET action = 'event' WHERE action IS NULL OR BTRIM(action) = ''`,
  `UPDATE workspace_transactions SET title = 'Workspace transaction' WHERE title IS NULL OR BTRIM(title) = ''`,
  `UPDATE workspace_transactions SET status = 'completed' WHERE status IS NULL OR BTRIM(status) = ''`,
  `ALTER TABLE workspace_transactions ALTER COLUMN category SET NOT NULL`,
  `ALTER TABLE workspace_transactions ALTER COLUMN action SET NOT NULL`,
  `ALTER TABLE workspace_transactions ALTER COLUMN title SET NOT NULL`,
  `ALTER TABLE workspace_transactions ALTER COLUMN metadata SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE workspace_transactions ALTER COLUMN metadata SET NOT NULL`,
  `ALTER TABLE workspace_transactions DROP CONSTRAINT IF EXISTS workspace_transactions_status_check`,
  `ALTER TABLE workspace_transactions ADD CONSTRAINT workspace_transactions_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_transactions_scope ON workspace_transactions (project_id, app_type_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_transactions_related ON workspace_transactions (related_kind, related_id, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS value JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_display_id_unique ON projects (display_id) WHERE display_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_requirements_display_id_unique ON requirements (display_id) WHERE display_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_test_cases_display_id_unique ON test_cases (display_id) WHERE display_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_test_suites_display_id_unique ON test_suites (display_id) WHERE display_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_step_groups_display_id_unique ON shared_step_groups (display_id) WHERE display_id IS NOT NULL`,
  `
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM projects
      WHERE display_id IS NULL
    )
    UPDATE projects
    SET display_id = 'PROJ-' || numbered.seq
    FROM numbered
    WHERE projects.id = numbered.id
  `,
  `
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM requirements
      WHERE display_id IS NULL
    )
    UPDATE requirements
    SET display_id = 'RC_' || numbered.seq
    FROM numbered
    WHERE requirements.id = numbered.id
  `,
  `
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM test_cases
      WHERE display_id IS NULL
    )
    UPDATE test_cases
    SET display_id = 'TC_' || numbered.seq
    FROM numbered
    WHERE test_cases.id = numbered.id
  `,
  `
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM test_suites
      WHERE display_id IS NULL
    )
    UPDATE test_suites
    SET display_id = 'TS-' || numbered.seq
    FROM numbered
    WHERE test_suites.id = numbered.id
  `,
  `
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM shared_step_groups
      WHERE display_id IS NULL
    )
    UPDATE shared_step_groups
    SET display_id = 'SG-' || numbered.seq
    FROM numbered
    WHERE shared_step_groups.id = numbered.id
  `
];

const ensureRuntimeSchema = async () => {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      for (const statement of statements) {
        await db.query(statement);
      }
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  return bootstrapPromise;
};

module.exports = {
  ensureRuntimeSchema
};
