const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const workspaceTransactionService = require("../services/workspaceTransaction.service");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

module.exports = async function (fastify) {
  fastify.get("/workspace-transactions", async (req) => {
    await fastify.authenticate(req);

    const { project_id, app_type_id, category, limit } = req.query;
    let scopedProjectId = project_id || null;

    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);

      if (project_id && project_id !== appType.project_id) {
        throw new Error("Selected app type must belong to the current project");
      }

      scopedProjectId = appType.project_id;
    } else if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw createError("Project scope is required.", 403);
    }

    return workspaceTransactionService.listTransactions({
      project_id: scopedProjectId || undefined,
      app_type_id: app_type_id || undefined,
      category: category || undefined,
      limit: limit !== undefined ? Number(limit) : undefined
    });
  });

  fastify.get("/workspace-transactions/:id/events", async (req) => {
    await fastify.authenticate(req);

    const transaction = await workspaceTransactionService.getTransaction(req.params.id);

    if (transaction.project_id) {
      await projectService.getProject(transaction.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw createError("Project scope is required.", 403);
    }

    return workspaceTransactionService.listTransactionEvents(transaction.id);
  });
};
