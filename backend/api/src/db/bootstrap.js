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
