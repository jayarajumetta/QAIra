const db = require("../db");
const { v4: uuid } = require("uuid");
const requirementTestCaseService = require("./requirementTestCase.service");
const displayIdService = require("./displayId.service");
const workspaceTransactionService = require("./workspaceTransaction.service");

const hydrateTestCaseIds = async (requirement) => {
  if (!requirement) {
    return requirement;
  }

  return {
    ...requirement,
    test_case_ids: await requirementTestCaseService.getTestCaseIdsForRequirement(requirement.id)
  };
};

exports.bulkImportRequirements = async ({ project_id, rows = [], created_by, transaction_id } = {}) => {
  if (!project_id) {
    throw new Error("project_id is required");
  }

  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("At least one row is required");
  }

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) {
    throw new Error("Project not found");
  }

  const created = [];
  const errors = [];
  const transaction = transaction_id
    ? await workspaceTransactionService.updateTransaction(transaction_id, {
        project_id,
        category: "bulk_import",
        action: "requirement_import",
        status: "running",
        title: "Requirement import",
        description: `Importing ${rows.length} requirement${rows.length === 1 ? "" : "s"} from CSV.`,
        metadata: {
          import_source: "csv",
          total_rows: rows.length,
          total_items: rows.length,
          processed_items: 0,
          progress_percent: 0,
          current_phase: "prepare"
        },
        started_at: new Date().toISOString()
      })
    : await workspaceTransactionService.createTransaction({
        project_id,
        category: "bulk_import",
        action: "requirement_import",
        status: "running",
        title: "Requirement import",
        description: `Importing ${rows.length} requirement${rows.length === 1 ? "" : "s"} from CSV.`,
        metadata: {
          import_source: "csv",
          total_rows: rows.length,
          total_items: rows.length,
          processed_items: 0,
          progress_percent: 0,
          current_phase: "prepare"
        },
        created_by,
        started_at: new Date().toISOString()
      });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "prepare",
    message: `Started requirement import for ${rows.length} CSV row${rows.length === 1 ? "" : "s"}.`,
    details: {
      import_source: "csv",
      total_rows: rows.length
    }
  });

  for (const [index, row] of rows.entries()) {
    const title = typeof row?.title === "string" ? row.title.trim() : "";

    try {
      if (title.length < 2) {
        throw new Error("Title must be at least 2 characters");
      }

      const response = await exports.createRequirement({
        project_id,
        title,
        description: typeof row?.description === "string" ? row.description : undefined,
        priority: typeof row?.priority === "number" && Number.isFinite(row.priority) ? row.priority : undefined,
        status: typeof row?.status === "string" ? row.status : undefined,
        created_by
      });

      created.push({
        row: index + 1,
        id: response.id,
        title
      });
    } catch (error) {
      errors.push({
        row: index + 1,
        title: title || null,
        message: error.message || "Unable to import requirement"
      });
    }

    const processed = index + 1;

    if (processed === 1 || processed === rows.length || processed % 10 === 0) {
      await workspaceTransactionService.updateTransaction(transaction.id, {
        description: `Imported ${created.length} of ${rows.length} requirement${rows.length === 1 ? "" : "s"} so far.`,
        metadata: {
          processed_items: processed,
          total_items: rows.length,
          imported: created.length,
          failed: errors.length,
          progress_percent: rows.length ? Math.round((processed / rows.length) * 100) : 0,
          current_phase: "import"
        }
      });
      await workspaceTransactionService.appendTransactionEvent(transaction.id, {
        phase: "import",
        message: `Processed ${processed} of ${rows.length} requirement row${rows.length === 1 ? "" : "s"}.`,
        details: {
          processed_items: processed,
          total_items: rows.length,
          imported: created.length,
          failed: errors.length
        }
      });
    }
  }

  const response = {
    imported: created.length,
    failed: errors.length,
    created,
    errors
  };

  await workspaceTransactionService.updateTransaction(transaction.id, {
    status: created.length ? "completed" : "failed",
    description: created.length
      ? `Imported ${created.length} of ${rows.length} requirement${rows.length === 1 ? "" : "s"} from CSV.`
      : "No requirements were imported from the CSV file.",
    metadata: {
      import_source: "csv",
      total_rows: rows.length,
      total_items: rows.length,
      processed_items: rows.length,
      imported: created.length,
      failed: errors.length,
      progress_percent: 100,
      current_phase: "completed"
    },
    completed_at: new Date().toISOString()
  });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    level: created.length ? "success" : "error",
    phase: "complete",
    message: created.length
      ? `Imported ${created.length} requirement${created.length === 1 ? "" : "s"} with ${errors.length} failure${errors.length === 1 ? "" : "s"}.`
      : "Requirement import completed with no created records.",
    details: {
      imported: created.length,
      failed: errors.length,
      sample_errors: errors.slice(0, 10)
    }
  });

  return response;
};

exports.createRequirement = async ({ project_id, title, description, priority, status, created_by }) => {
  if (!project_id || !title) {
    throw new Error("Missing required fields");
  }

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) throw new Error("Project not found");

  const id = uuid();
  const display_id = await displayIdService.createDisplayId("requirement");

  await db.prepare(`
    INSERT INTO requirements (id, display_id, project_id, title, description, priority, status, created_by, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    display_id,
    project_id,
    title,
    description || null,
    priority ?? 3,
    status || null,
    created_by || null,
    created_by || null
  );

  return { id };
};

exports.getRequirements = async ({ project_id, status, priority }) => {
  let query = `SELECT * FROM requirements WHERE 1=1`;
  const params = [];

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  if (priority !== undefined) {
    query += ` AND priority = ?`;
    params.push(priority);
  }

  query += ` ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC`;

  const rows = await db.prepare(query).all(...params);
  return Promise.all(rows.map(hydrateTestCaseIds));
};

exports.getRequirement = async (id) => {
  const requirement = await db.prepare(`
    SELECT * FROM requirements WHERE id = ?
  `).get(id);

  if (!requirement) throw new Error("Requirement not found");

  return hydrateTestCaseIds(requirement);
};

exports.updateRequirement = async (id, data) => {
  const existing = await exports.getRequirement(id);

  if (data.project_id) {
    const project = await db.prepare(`
      SELECT id FROM projects WHERE id = ?
    `).get(data.project_id);

    if (!project) throw new Error("Project not found");
  }

  await db.prepare(`
    UPDATE requirements
    SET project_id = ?, title = ?, description = ?, priority = ?, status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.project_id ?? existing.project_id,
    data.title ?? existing.title,
    data.description ?? existing.description,
    data.priority ?? existing.priority,
    data.status ?? existing.status,
    data.updated_by ?? existing.updated_by ?? existing.created_by ?? null,
    id
  );

  return { updated: true };
};

exports.deleteRequirement = async (id) => {
  await exports.getRequirement(id);
  await db.prepare(`
    DELETE FROM requirement_test_cases
    WHERE requirement_id = ?
  `).run(id);

  await db.prepare(`
    UPDATE test_cases
    SET requirement_id = NULL
    WHERE requirement_id = ?
  `).run(id);

  await db.prepare(`
    DELETE FROM requirements WHERE id = ?
  `).run(id);

  return { deleted: true };
};
