const db = require("./index");

let bootstrapPromise = null;

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
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_integrations_type_active ON integrations (type, is_active)`,
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
      sort_order INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (execution_id, test_case_id)
    )
  `,
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
  `CREATE INDEX IF NOT EXISTS idx_execution_case_snapshots_execution_id ON execution_case_snapshots (execution_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_step_snapshots_execution_case ON execution_step_snapshots (execution_id, test_case_id, step_order)`
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
