const service = require("../services/requirement.service");
const projectService = require("../services/project.service");

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

  fastify.delete("/requirements/:id", async (req) => {
    await fastify.authenticate(req);
    const requirement = await service.getRequirement(req.params.id);
    // Verify user is member of the requirement's project
    await projectService.getProject(requirement.project_id, req.user.id);
    return service.deleteRequirement(req.params.id);
  });
};
