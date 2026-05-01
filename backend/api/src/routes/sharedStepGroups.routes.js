const service = require("../services/sharedStepGroup.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");

module.exports = async function (fastify) {
  fastify.post("/shared-step-groups", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      steps: { required: false, type: "array" },
      parameter_values: { required: false, type: "object" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return service.createSharedStepGroup({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/shared-step-groups", async (req) => {
    await fastify.authenticate(req);

    if (req.query.app_type_id) {
      const appType = await appTypeService.getAppType(req.query.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return service.listSharedStepGroups(req.query);
  });

  fastify.get("/shared-step-groups/:id", async (req) => {
    await fastify.authenticate(req);

    const group = await service.getSharedStepGroup(req.params.id);
    const appType = await appTypeService.getAppType(group.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return group;
  });

  fastify.put("/shared-step-groups/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: false, type: "string" },
      name: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      steps: { required: false, type: "array" },
      parameter_values: { required: false, type: "object" }
    }, req.body);

    const existing = await service.getSharedStepGroup(req.params.id);
    const appType = await appTypeService.getAppType(req.body.app_type_id || existing.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return service.updateSharedStepGroup(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
  });

  fastify.delete("/shared-step-groups/:id", async (req) => {
    await fastify.authenticate(req);

    const group = await service.getSharedStepGroup(req.params.id);
    const appType = await appTypeService.getAppType(group.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return service.deleteSharedStepGroup(req.params.id);
  });
};
