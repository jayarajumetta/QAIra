const service = require("../services/requirement.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const requirementDesignService = require("../services/requirementDesign.service");

module.exports = async function (fastify) {
  fastify.post("/requirements", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      project_id: { required: true, type: "string" },
      title: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" }
    }, req.body);

    // Verify user is member of project
    await projectService.getProject(req.body.project_id, req.user.id);

    return service.createRequirement(req.body);
  });

  fastify.get("/requirements", async (req) => {
    await fastify.authenticate(req);
    const { project_id, status, priority } = req.query;
    
    // If filtering by project, verify access
    if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    }
    
    return service.getRequirements({
      project_id,
      status,
      priority: priority !== undefined ? Number(priority) : undefined
    });
  });

  fastify.get("/requirements/:id", async (req) => {
    await fastify.authenticate(req);
    const requirement = await service.getRequirement(req.params.id);
    // Verify user is member of the requirement's project
    await projectService.getProject(requirement.project_id, req.user.id);
    return requirement;
  });

  fastify.put("/requirements/:id", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      project_id: { required: false, type: "string" },
      title: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" }
    }, req.body);

    const requirement = await service.getRequirement(req.params.id);
    // Verify user is member of the requirement's project
    await projectService.getProject(requirement.project_id, req.user.id);

    return service.updateRequirement(req.params.id, req.body);
  });

  fastify.post("/requirements/:id/generate-test-cases", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      integration_id: { required: false, type: "string" },
      max_cases: { required: false, type: "number" },
      status: { required: false, type: "string" }
    }, req.body);

    const requirement = await service.getRequirement(req.params.id);
    await projectService.getProject(requirement.project_id, req.user.id);

    const appType = await appTypeService.getAppType(req.body.app_type_id);

    if (appType.project_id !== requirement.project_id) {
      throw new Error("App type must belong to the same project as the requirement");
    }

    return requirementDesignService.generateRequirementTestCases({
      requirement,
      appType,
      integration_id: req.body.integration_id,
      max_cases: req.body.max_cases,
      status: req.body.status
    });
  });

  fastify.post("/requirements/:id/design-test-cases-preview", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      integration_id: { required: false, type: "string" },
      max_cases: { required: false, type: "number" }
    }, req.body);

    const requirement = await service.getRequirement(req.params.id);
    await projectService.getProject(requirement.project_id, req.user.id);

    const appType = await appTypeService.getAppType(req.body.app_type_id);

    if (appType.project_id !== requirement.project_id) {
      throw new Error("App type must belong to the same project as the requirement");
    }

    return requirementDesignService.previewRequirementTestCases({
      requirement,
      appType,
      integration_id: req.body.integration_id,
      max_cases: req.body.max_cases
    });
  });

  fastify.post("/requirements/:id/design-test-cases-accept", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      status: { required: false, type: "string" },
      cases: { required: true, type: "array" }
    }, req.body);

    if (!req.body.cases.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      throw new Error("cases must contain test case objects");
    }

    const requirement = await service.getRequirement(req.params.id);
    await projectService.getProject(requirement.project_id, req.user.id);

    const appType = await appTypeService.getAppType(req.body.app_type_id);

    if (appType.project_id !== requirement.project_id) {
      throw new Error("App type must belong to the same project as the requirement");
    }

    return requirementDesignService.acceptRequirementTestCases({
      requirement,
      appType,
      status: req.body.status,
      cases: req.body.cases
    });
  });

  fastify.delete("/requirements/:id", async (req) => {
    await fastify.authenticate(req);
    const requirement = await service.getRequirement(req.params.id);
    // Verify user is member of the requirement's project
    await projectService.getProject(requirement.project_id, req.user.id);
    return service.deleteRequirement(req.params.id);
  });
};
