const service = require("../services/testEnvironment.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");

module.exports = async function (fastify) {
  fastify.post("/test-environments", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      base_url: { required: false, type: "string" },
      browser: { required: false, type: "string" },
      notes: { required: false, type: "string" },
      variables: { required: false, type: "array" }
    }, req.body);

    await projectService.getProject(req.body.project_id, req.user.id);

    if (req.body.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);

      if (appType.project_id !== req.body.project_id) {
        throw new Error("App type must belong to the selected project");
      }
    }

    return service.createTestEnvironment(req.body);
  });

  fastify.get("/test-environments", async (req) => {
    await fastify.authenticate(req);
    const { project_id, app_type_id } = req.query;

    if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    } else if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return service.getTestEnvironments({ project_id, app_type_id });
  });

  fastify.get("/test-environments/:id", async (req) => {
    await fastify.authenticate(req);
    const environment = await service.getTestEnvironment(req.params.id);
    await projectService.getProject(environment.project_id, req.user.id);
    return environment;
  });

  fastify.put("/test-environments/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: false, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      base_url: { required: false, type: "string" },
      browser: { required: false, type: "string" },
      notes: { required: false, type: "string" },
      variables: { required: false, type: "array" }
    }, req.body);

    const environment = await service.getTestEnvironment(req.params.id);
    await projectService.getProject(environment.project_id, req.user.id);

    if (req.body.project_id) {
      await projectService.getProject(req.body.project_id, req.user.id);
    }

    return service.updateTestEnvironment(req.params.id, req.body);
  });

  fastify.delete("/test-environments/:id", async (req) => {
    await fastify.authenticate(req);
    const environment = await service.getTestEnvironment(req.params.id);
    await projectService.getProject(environment.project_id, req.user.id);
    return service.deleteTestEnvironment(req.params.id);
  });
};
