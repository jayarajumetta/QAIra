const projectService = require("../services/project.service");
const projectSyncService = require("../services/projectSync.service");

module.exports = async function (fastify) {
  fastify.post("/projects/:id/sync/:provider", async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.params.id, req.user.id);

    const response = await projectSyncService.queueProjectSync({
      project_id: req.params.id,
      provider: req.params.provider,
      created_by: req.user.id,
      trigger_mode: "manual"
    });

    projectSyncService.triggerSyncProcessing();
    return response;
  });
};
