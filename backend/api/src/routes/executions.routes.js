const service = require("../services/execution.service");
const projectService = require("../services/project.service");

module.exports = async function (fastify) {

  // CREATE EXECUTION
  fastify.post("/executions", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      name: { required: false, type: "string" },
      created_by: { required: true, type: "string" }
    }, req.body);

    // Verify user is member of project
    projectService.getProject(req.body.project_id, req.user.id);

    return service.createExecution(req.body);
  });


  // GET ALL EXECUTIONS
  fastify.get("/executions", async (req) => {
    await fastify.authenticate(req);

    const { project_id, status } = req.query;

    // If filtering by project, verify access
    if (project_id) {
      projectService.getProject(project_id, req.user.id);
    }

    return service.getExecutions({ project_id, status });
  });


  // GET ONE EXECUTION
  fastify.get("/executions/:id", async (req) => {
    await fastify.authenticate(req);
    const execution = service.getExecution(req.params.id);
    // Verify user is member of the execution's project
    projectService.getProject(execution.project_id, req.user.id);
    return execution;
  });


  // START EXECUTION
  fastify.post("/executions/:id/start", async (req) => {
    await fastify.authenticate(req);
    const execution = service.getExecution(req.params.id);
    // Verify user is member of the execution's project
    projectService.getProject(execution.project_id, req.user.id);
    return service.startExecution(req.params.id);
  });


  // COMPLETE EXECUTION
  fastify.post("/executions/:id/complete", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      status: { required: true, enum: ["completed", "failed"] }
    }, req.body);

    const execution = service.getExecution(req.params.id);
    // Verify user is member of the execution's project
    projectService.getProject(execution.project_id, req.user.id);

    return service.completeExecution(req.params.id, req.body.status);
  });


  // DELETE EXECUTION
  fastify.delete("/executions/:id", async (req) => {
    await fastify.authenticate(req);
    const execution = service.getExecution(req.params.id);
    // Verify user is member of the execution's project
    projectService.getProject(execution.project_id, req.user.id);
    return service.deleteExecution(req.params.id);
  });

};
