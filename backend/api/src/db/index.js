const crypto = require("crypto");
const Database = require("better-sqlite3");

const db = new Database(process.env.DB_PATH, {
  verbose: console.log
});

db.pragma("foreign_keys = ON");

const hasTable = (name) => {
  return Boolean(
    db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `).get(name)
  );
};

const ensureExecutionScope = () => {
  if (!hasTable("executions")) {
    return;
  }

  const executionColumns = db.prepare(`PRAGMA table_info(executions)`).all();

  if (!executionColumns.some((column) => column.name === "app_type_id")) {
    db.prepare(`ALTER TABLE executions ADD COLUMN app_type_id TEXT REFERENCES app_types(id)`).run();
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS execution_suites (
      execution_id TEXT NOT NULL,
      suite_id TEXT NOT NULL,
      suite_name TEXT,
      PRIMARY KEY (execution_id, suite_id),
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
    )
  `).run();
};

const migrateExecutionSnapshots = () => {
  if (!hasTable("execution_suites") || !hasTable("execution_results")) {
    return;
  }

  const executionSuiteColumns = db.prepare(`PRAGMA table_info(execution_suites)`).all();
  const executionSuiteForeignKeys = db.prepare(`PRAGMA foreign_key_list(execution_suites)`).all();
  const suiteNeedsMigration = !executionSuiteColumns.some((column) => column.name === "suite_name")
    || executionSuiteForeignKeys.some((key) => key.table === "test_suites");

  if (suiteNeedsMigration) {
    db.pragma("foreign_keys = OFF");

    db.prepare(`
      CREATE TABLE IF NOT EXISTS execution_suites__new (
        execution_id TEXT NOT NULL,
        suite_id TEXT NOT NULL,
        suite_name TEXT,
        PRIMARY KEY (execution_id, suite_id),
        FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
      )
    `).run();

    db.prepare(`
      INSERT INTO execution_suites__new (execution_id, suite_id, suite_name)
      SELECT execution_suites.execution_id, execution_suites.suite_id, test_suites.name
      FROM execution_suites
      LEFT JOIN test_suites ON test_suites.id = execution_suites.suite_id
    `).run();

    db.prepare(`DROP TABLE execution_suites`).run();
    db.prepare(`ALTER TABLE execution_suites__new RENAME TO execution_suites`).run();

    db.pragma("foreign_keys = ON");
  }

  const executionResultColumns = db.prepare(`PRAGMA table_info(execution_results)`).all();
  const executionResultForeignKeys = db.prepare(`PRAGMA foreign_key_list(execution_results)`).all();
  const hasSnapshotTestCaseTitle = executionResultColumns.some((column) => column.name === "test_case_title");
  const hasSnapshotSuiteId = executionResultColumns.some((column) => column.name === "suite_id");
  const hasSnapshotSuiteName = executionResultColumns.some((column) => column.name === "suite_name");
  const resultNeedsMigration = !executionResultColumns.some((column) => column.name === "test_case_title")
    || !executionResultColumns.some((column) => column.name === "suite_id")
    || !executionResultColumns.some((column) => column.name === "suite_name")
    || executionResultForeignKeys.some((key) => key.table === "test_cases");

  if (resultNeedsMigration) {
    db.pragma("foreign_keys = OFF");

    db.prepare(`
      CREATE TABLE IF NOT EXISTS execution_results__new (
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
      )
    `).run();

    const testCaseTitleExpression = hasSnapshotTestCaseTitle ? "execution_results.test_case_title" : "test_cases.title";
    const suiteIdExpression = hasSnapshotSuiteId
      ? "execution_results.suite_id"
      : `(
          SELECT suite_test_cases.suite_id
          FROM suite_test_cases
          WHERE suite_test_cases.test_case_id = execution_results.test_case_id
          ORDER BY suite_test_cases.sort_order ASC
          LIMIT 1
        )`;
    const suiteNameExpression = hasSnapshotSuiteName
      ? "execution_results.suite_name"
      : `(
          SELECT test_suites.name
          FROM suite_test_cases
          JOIN test_suites ON test_suites.id = suite_test_cases.suite_id
          WHERE suite_test_cases.test_case_id = execution_results.test_case_id
          ORDER BY suite_test_cases.sort_order ASC
          LIMIT 1
        )`;

    db.prepare(`
      INSERT INTO execution_results__new (
        id, execution_id, test_case_id, test_case_title, suite_id, suite_name, app_type_id,
        status, duration_ms, error, logs, executed_by, created_at
      )
      SELECT
        execution_results.id,
        execution_results.execution_id,
        execution_results.test_case_id,
        ${testCaseTitleExpression},
        COALESCE(
          ${suiteIdExpression},
          test_cases.suite_id
        ),
        COALESCE(
          ${suiteNameExpression},
          (
            SELECT test_suites.name
            FROM test_suites
            WHERE test_suites.id = test_cases.suite_id
          )
        ),
        execution_results.app_type_id,
        execution_results.status,
        execution_results.duration_ms,
        execution_results.error,
        execution_results.logs,
        execution_results.executed_by,
        execution_results.created_at
      FROM execution_results
      LEFT JOIN test_cases ON test_cases.id = execution_results.test_case_id
    `).run();

    db.prepare(`DROP TABLE execution_results`).run();
    db.prepare(`ALTER TABLE execution_results__new RENAME TO execution_results`).run();

    db.pragma("foreign_keys = ON");
  }
};

const ensureSuiteTestCaseMapping = () => {
  if (!hasTable("test_cases") || !hasTable("test_suites")) {
    return;
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS suite_test_cases (
      suite_id TEXT NOT NULL,
      test_case_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (suite_id, test_case_id),
      FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE CASCADE,
      FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
    )
  `).run();

  const testCaseColumns = db.prepare(`PRAGMA table_info(test_cases)`).all();
  const suiteColumn = testCaseColumns.find((column) => column.name === "suite_id");

  if (suiteColumn && suiteColumn.notnull === 1) {
    db.pragma("foreign_keys = OFF");

    db.prepare(`
      CREATE TABLE IF NOT EXISTS test_cases__new (
        id TEXT PRIMARY KEY,
        suite_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        priority INTEGER DEFAULT 3,
        status TEXT DEFAULT 'active',
        requirement_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (suite_id) REFERENCES test_suites(id),
        FOREIGN KEY (requirement_id) REFERENCES requirements(id)
      )
    `).run();

    db.prepare(`
      INSERT INTO test_cases__new (id, suite_id, title, description, priority, status, requirement_id, created_at)
      SELECT id, suite_id, title, description, priority, status, requirement_id, created_at
      FROM test_cases
    `).run();

    db.prepare(`DROP TABLE test_cases`).run();
    db.prepare(`ALTER TABLE test_cases__new RENAME TO test_cases`).run();

    db.pragma("foreign_keys = ON");
  }

  const legacyMappings = db.prepare(`
    SELECT id, suite_id, created_at
    FROM test_cases
    WHERE suite_id IS NOT NULL
    ORDER BY created_at ASC, id ASC
  `).all();

  const insertMapping = db.prepare(`
    INSERT OR IGNORE INTO suite_test_cases (suite_id, test_case_id, sort_order)
    VALUES (?, ?, ?)
  `);
  const nextSort = db.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_value
    FROM suite_test_cases
    WHERE suite_id = ?
  `);

  legacyMappings.forEach((row) => {
    const next = nextSort.get(row.suite_id).next_value;
    insertMapping.run(row.suite_id, row.id, next);
  });
};

const ensureRequirementTestCaseMapping = () => {
  if (!hasTable("requirements") || !hasTable("test_cases")) {
    return;
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS requirement_test_cases (
      requirement_id TEXT NOT NULL,
      test_case_id TEXT NOT NULL,
      PRIMARY KEY (requirement_id, test_case_id),
      FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE,
      FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
    )
  `).run();

  if (!db.prepare(`PRAGMA table_info(test_cases)`).all().some((column) => column.name === "requirement_id")) {
    return;
  }

  const legacyMappings = db.prepare(`
    SELECT id, requirement_id
    FROM test_cases
    WHERE requirement_id IS NOT NULL
  `).all();

  const insertMapping = db.prepare(`
    INSERT OR IGNORE INTO requirement_test_cases (requirement_id, test_case_id)
    VALUES (?, ?)
  `);

  legacyMappings.forEach((row) => {
    insertMapping.run(row.requirement_id, row.id);
  });
};

const ensureDefaultRolesAndMemberships = () => {
  if (!hasTable("roles") || !hasTable("users") || !hasTable("projects") || !hasTable("project_members")) {
    return;
  }

  const existingRoles = db.prepare(`SELECT id, name FROM roles`).all();
  let memberRole = existingRoles.find((role) => role.name === "member");
  let adminRole = existingRoles.find((role) => role.name === "admin");

  if (!memberRole) {
    memberRole = { id: crypto.randomUUID(), name: "member" };
    db.prepare(`INSERT INTO roles (id, name) VALUES (?, ?)`).run(memberRole.id, memberRole.name);
  }

  if (!adminRole) {
    adminRole = { id: crypto.randomUUID(), name: "admin" };
    db.prepare(`INSERT INTO roles (id, name) VALUES (?, ?)`).run(adminRole.id, adminRole.name);
  }

  const users = db.prepare(`SELECT id, email FROM users`).all();
  const projects = db.prepare(`SELECT id FROM projects`).all();
  const selectMembership = db.prepare(`
    SELECT id
    FROM project_members
    WHERE project_id = ? AND user_id = ?
  `);
  const insertMembership = db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, role_id)
    VALUES (?, ?, ?, ?)
  `);
  const updateMembership = db.prepare(`
    UPDATE project_members
    SET role_id = ?
    WHERE id = ?
  `);

  users.forEach((user) => {
    const roleId = user.email === "MJ@qualipal.in" ? adminRole.id : memberRole.id;

    projects.forEach((project) => {
      const existing = selectMembership.get(project.id, user.id);

      if (existing) {
        updateMembership.run(roleId, existing.id);
      } else {
        insertMembership.run(crypto.randomUUID(), project.id, user.id, roleId);
      }
    });
  });
};

ensureExecutionScope();
migrateExecutionSnapshots();
ensureSuiteTestCaseMapping();
ensureRequirementTestCaseMapping();
ensureDefaultRolesAndMemberships();

module.exports = db;
