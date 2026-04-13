const service = require("../services/testDataSet.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const { TEST_DATA_SET_MODE_VALUES } = require("../domain/catalog");

module.exports = async function (fastify) {
  fastify.post("/test-data-sets", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      mode: { required: true, enum: TEST_DATA_SET_MODE_VALUES },
      columns: { required: false, type: "array" },
      rows: { required: false, type: "array" }
    }, req.body);

    await projectService.getProject(req.body.project_id, req.user.id);

    if (req.body.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);

      if (appType.project_id !== req.body.project_id) {
        throw new Error("App type must belong to the selected project");
      }
    }

    return service.createTestDataSet(req.body);
  });

  fastify.get("/test-data-sets", async (req) => {
    await fastify.authenticate(req);
    const { project_id, app_type_id } = req.query;

    if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    } else if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return service.getTestDataSets({ project_id, app_type_id });
  });

  fastify.get("/test-data-sets/:id", async (req) => {
    await fastify.authenticate(req);
    const dataSet = await service.getTestDataSet(req.params.id);
    await projectService.getProject(dataSet.project_id, req.user.id);
    return dataSet;
  });

  fastify.put("/test-data-sets/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: false, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      mode: { required: false, enum: TEST_DATA_SET_MODE_VALUES },
      columns: { required: false, type: "array" },
      rows: { required: false, type: "array" }
    }, req.body);

    const dataSet = await service.getTestDataSet(req.params.id);
    await projectService.getProject(dataSet.project_id, req.user.id);

    if (req.body.project_id) {
      await projectService.getProject(req.body.project_id, req.user.id);
    }

    return service.updateTestDataSet(req.params.id, req.body);
  });

  fastify.delete("/test-data-sets/:id", async (req) => {
    await fastify.authenticate(req);
    const dataSet = await service.getTestDataSet(req.params.id);
    await projectService.getProject(dataSet.project_id, req.user.id);
    return service.deleteTestDataSet(req.params.id);
  });
};
