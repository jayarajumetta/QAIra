const service = require("../services/testCase.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");

module.exports = async function (fastify) {
  fastify.post("/test-cases", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      app_type_id: { required: false, type: "string" },
      title: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" },
      requirement_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      suite_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" }
    }, req.body);

    // Verify access if app_type_id provided
    if (req.body.app_type_id) {
      const appType = appTypeService.getAppType(req.body.app_type_id);
      projectService.getProject(appType.project_id, req.user.id);
    }

    return service.createTestCase(req.body);
  });

  fastify.get("/test-cases", async (req) => {
    await fastify.authenticate(req);
    const { suite_id, requirement_id, status, app_type_id } = req.query;
    
    // If filtering by app_type, verify access
    if (app_type_id) {
      const appType = appTypeService.getAppType(app_type_id);
      projectService.getProject(appType.project_id, req.user.id);
    }
    
    return service.getTestCases({ suite_id, requirement_id, status, app_type_id });
  });

  fastify.get("/test-cases/:id", async (req) => {
    await fastify.authenticate(req);
    const testCase = service.getTestCase(req.params.id);
    // Verify access if app_type exists
    if (testCase.app_type_id) {
      const appType = appTypeService.getAppType(testCase.app_type_id);
      projectService.getProject(appType.project_id, req.user.id);
    }
    return testCase;
  });

  fastify.put("/test-cases/:id", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      app_type_id: { required: false, type: "string" },
      title: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" },
      requirement_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      suite_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" }
    }, req.body);

    const testCase = service.getTestCase(req.params.id);
    if (testCase.app_type_id) {
      const appType = appTypeService.getAppType(testCase.app_type_id);
      projectService.getProject(appType.project_id, req.user.id);
    }

    return service.updateTestCase(req.params.id, req.body);
  });

  fastify.delete("/test-cases/:id", async (req) => {
    await fastify.authenticate(req);
    const testCase = service.getTestCase(req.params.id);
    if (testCase.app_type_id) {
      const appType = appTypeService.getAppType(testCase.app_type_id);
      projectService.getProject(appType.project_id, req.user.id);
    }
    return service.deleteTestCase(req.params.id);
  });
};
