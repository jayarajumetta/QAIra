const Database = require("better-sqlite3");

const db = new Database(process.env.DB_PATH, {
  verbose: console.log
});

db.pragma("foreign_keys = ON");

const executionColumns = db.prepare(`PRAGMA table_info(executions)`).all();

if (!executionColumns.some((column) => column.name === "app_type_id")) {
  db.prepare(`ALTER TABLE executions ADD COLUMN app_type_id TEXT REFERENCES app_types(id)`).run();
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS execution_suites (
    execution_id TEXT NOT NULL,
    suite_id TEXT NOT NULL,
    PRIMARY KEY (execution_id, suite_id),
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE,
    FOREIGN KEY (suite_id) REFERENCES test_suites(id)
  )
`).run();

module.exports = db;
