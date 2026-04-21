const service = require("../services/testCase.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const requirementService = require("../services/requirement.service");
const requirementDesignService = require("../services/requirementDesign.service");
const aiTestCaseGenerationService = require("../services/aiTestCaseGeneration.service");
const { TEST_CASE_AUTOMATED_VALUES, TEST_CASE_STATUS_VALUES } = require("../domain/catalog");

const resolveScopedRequirements = async (requirementIds = [], projectId) => {
  const ids = [...new Set((Array.isArray(requirementIds) ? requirementIds : []).filter(Boolean))];

  if (!ids.length) {
    throw new Error("Select at least one requirement");
  }

  const requirements = [];

  for (const requirementId of ids) {
    const requirement = await requirementService.getRequirement(requirementId);

    if (requirement.project_id !== projectId) {
      throw new Error("Requirement must belong to the same project as the selected app type");
    }

    requirements.push(requirement);
  }

  return requirements;
};

module.exports = async function (fastify) {
  fastify.post("/test-cases", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      app_type_id: { required: false, type: "string" },
      title: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      parameter_values: { required: false, type: "object" },
      automated: { required: false, type: "string", enum: TEST_CASE_AUTOMATED_VALUES },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string", enum: TEST_CASE_STATUS_VALUES },
      requirement_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      suite_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      steps: { required: false, type: "array" }
    }, req.body);

    // Verify access if app_type_id provided
    if (req.body.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return service.createTestCase(req.body);
  });

  fastify.post("/test-cases/import", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_id: { required: false, type: "string" },
      import_source: { required: false, type: "string" },
      rows: { required: true, type: "array" }
    }, req.body);

    if (!req.body.rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      throw new Error("rows must contain CSV objects");
    }

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return service.bulkImportTestCases({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/test-cases", async (req) => {
    await fastify.authenticate(req);
    const { suite_id, requirement_id, status, app_type_id } = req.query;
    
    // If filtering by app_type, verify access
    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }
    
    return service.getTestCases({ suite_id, requirement_id, status, app_type_id });
  });

  fastify.get("/test-cases/:id", async (req) => {
    await fastify.authenticate(req);
    const testCase = await service.getTestCase(req.params.id);
    // Verify access if app_type exists
    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }
    return testCase;
  });

  fastify.post("/test-cases/design-test-cases-preview", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_ids: { required: true, type: "array", items: "string" },
      integration_id: { required: false, type: "string" },
      max_cases: { required: false, type: "number" },
      additional_context: { required: false, type: "string" },
      external_links: { required: false, type: "array", items: "string" },
      images: { required: false, type: "array" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    const requirements = await resolveScopedRequirements(req.body.requirement_ids, appType.project_id);

    return requirementDesignService.previewRequirementsTestCases({
      requirements,
      appType,
      integration_id: req.body.integration_id,
      max_cases: req.body.max_cases,
      additional_context: req.body.additional_context,
      external_links: req.body.external_links,
      images: req.body.images
    });
  });

  fastify.post("/test-cases/design-test-cases-accept", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_ids: { required: true, type: "array", items: "string" },
      status: { required: false, type: "string", enum: TEST_CASE_STATUS_VALUES },
      cases: { required: true, type: "array" }
    }, req.body);

    if (!req.body.cases.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      throw new Error("cases must contain test case objects");
    }

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    const requirements = await resolveScopedRequirements(req.body.requirement_ids, appType.project_id);

    return requirementDesignService.acceptGeneratedTestCases({
      requirements,
      appType,
      status: req.body.status,
      cases: req.body.cases
    });
  });

  fastify.get("/test-cases/ai-generation-jobs", async (req) => {
    await fastify.authenticate(req);

    const { app_type_id, status } = req.query;

    if (!app_type_id) {
      throw new Error("app_type_id is required");
    }

    const appType = await appTypeService.getAppType(app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return aiTestCaseGenerationService.listJobs({ app_type_id, status });
  });

  fastify.post("/test-cases/ai-generation-jobs", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_ids: { required: true, type: "array", items: "string" },
      integration_id: { required: false, type: "string" },
      max_cases_per_requirement: { required: false, type: "number" },
      parallel_requirement_limit: { required: false, type: "number" },
      additional_context: { required: false, type: "string" },
      external_links: { required: false, type: "array" },
      images: { required: false, type: "array" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    const response = await aiTestCaseGenerationService.createJob({
      ...req.body,
      created_by: req.user.id
    });

    aiTestCaseGenerationService.triggerJobProcessing();
    return response;
  });

  fastify.put("/test-cases/:id", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      app_type_id: { required: false, type: "string" },
      title: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      parameter_values: { required: false, type: "object" },
      automated: { required: false, type: "string", enum: TEST_CASE_AUTOMATED_VALUES },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string", enum: TEST_CASE_STATUS_VALUES },
      requirement_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      suite_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      steps: { required: false, type: "array" }
    }, req.body);

    const testCase = await service.getTestCase(req.params.id);
    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return service.updateTestCase(req.params.id, req.body);
  });

  fastify.post("/test-cases/:id/accept-generated", async (req) => {
    await fastify.authenticate(req);

    const testCase = await service.getTestCase(req.params.id);

    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return service.acceptGeneratedTestCase(req.params.id);
  });

  fastify.delete("/test-cases/:id/reject-generated", async (req) => {
    await fastify.authenticate(req);

    const testCase = await service.getTestCase(req.params.id);

    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return service.rejectGeneratedTestCase(req.params.id);
  });

  fastify.delete("/test-cases/:id", async (req) => {
    await fastify.authenticate(req);
    const testCase = await service.getTestCase(req.params.id);
    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }
    return service.deleteTestCase(req.params.id);
  });
};
