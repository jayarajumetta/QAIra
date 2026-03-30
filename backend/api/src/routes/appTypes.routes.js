const service = require("../services/appType.service");
const projectService = require("../services/project.service");

module.exports = async function (fastify) {

  // CREATE
  fastify.post("/app-types", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      type: { required: true, enum: ["web", "api", "android", "ios", "unified"] },
      is_unified: { required: false }
    }, req.body);

    // Verify user is member of project
    await projectService.getProject(req.body.project_id, req.user.id);

    return service.createAppType(req.body);
  });


  // GET ALL (optional filter by project)
  fastify.get("/app-types", async (req) => {
    await fastify.authenticate(req);
    const { project_id } = req.query;
    
    // If filtering by project, verify access
    if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    }
    
    return service.getAppTypes(project_id);
  });


  // GET ONE
  fastify.get("/app-types/:id", async (req) => {
    await fastify.authenticate(req);
    const appType = await service.getAppType(req.params.id);
    // Verify user is member of the app type's project
    await projectService.getProject(appType.project_id, req.user.id);
    return appType;
  });


  // UPDATE
  fastify.put("/app-types/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      name: { required: false, type: "string" },
      is_unified: { required: false }
    }, req.body);

    const appType = await service.getAppType(req.params.id);
    // Verify user is member of the app type's project
    await projectService.getProject(appType.project_id, req.user.id);
    
    return service.updateAppType(req.params.id, req.body);
  });


  // DELETE
  fastify.delete("/app-types/:id", async (req) => {
    await fastify.authenticate(req);
    const appType = await service.getAppType(req.params.id);
    // Verify user is member of the app type's project
    await projectService.getProject(appType.project_id, req.user.id);
    return service.deleteAppType(req.params.id);
  });

};
