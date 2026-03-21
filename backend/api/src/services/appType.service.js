const db = require("../db");
const { v4: uuid } = require("uuid");

const VALID_TYPES = ["web", "api", "android", "ios", "unified"];

// Create
exports.createAppType = ({ project_id, name, type, is_unified }) => {

  if (!VALID_TYPES.includes(type)) {
    throw new Error("Invalid app type");
  }

  // Validate project
  const project = db.prepare("SELECT id FROM projects WHERE id = ?")
    .get(project_id);

  if (!project) throw new Error("Project not found");

  // Prevent duplicate type per project
  const exists = db.prepare(`
    SELECT id FROM app_types 
    WHERE project_id = ? AND type = ?
  `).get(project_id, type);

  if (exists) {
    throw new Error(`App type '${type}' already exists in project`);
  }

  const id = uuid();

  db.prepare(`
    INSERT INTO app_types (id, project_id, name, type, is_unified)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, project_id, name, type, is_unified ? 1 : 0);

  return { id };
};


// Get all (optionally by project)
exports.getAppTypes = (project_id) => {
  if (project_id) {
    return db.prepare(`
      SELECT * FROM app_types WHERE project_id = ?
    `).all(project_id);
  }

  return db.prepare(`SELECT * FROM app_types`).all();
};


// Get one
exports.getAppType = (id) => {
  const appType = db.prepare(`
    SELECT * FROM app_types WHERE id = ?
  `).get(id);

  if (!appType) throw new Error("App type not found");

  return appType;
};


// Update
exports.updateAppType = (id, data) => {
  const existing = exports.getAppType(id);

  const name = data.name ?? existing.name;
  const is_unified = data.is_unified ?? existing.is_unified;

  db.prepare(`
    UPDATE app_types 
    SET name = ?, is_unified = ?
    WHERE id = ?
  `).run(name, is_unified ? 1 : 0, id);

  return { updated: true };
};


// Delete (with safety)
exports.deleteAppType = (id) => {
  const existing = exports.getAppType(id);

  const testSuite = db.prepare(`
    SELECT id FROM test_suites WHERE app_type_id = ?
  `).get(id);

  if (testSuite) {
    throw new Error("Cannot delete app type with existing test suites");
  }

  const result = db.prepare(`
    SELECT id FROM execution_results WHERE app_type_id = ?
  `).get(id);

  if (result) {
    throw new Error("Cannot delete app type with execution results");
  }

  db.prepare(`DELETE FROM app_types WHERE id = ?`).run(id);

  return { deleted: true };
};
