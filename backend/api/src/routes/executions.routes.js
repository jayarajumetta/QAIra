const service = require("../services/execution.service");

module.exports = async function (fastify) {

  // CREATE EXECUTION
  fastify.post("/executions", async (req) => {

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      name: { required: false, type: "string" },
      created_by: { required: true, type: "string" }
    }, req.body);

    return service.createExecution(req.body);
  });


  // GET ALL EXECUTIONS
  fastify.get("/executions", async (req) => {

    const { project_id, status } = req.query;

    return service.getExecutions({ project_id, status });
  });


  // GET ONE EXECUTION
  fastify.get("/executions/:id", async (req) => {
    return service.getExecution(req.params.id);
  });


  // START EXECUTION
  fastify.post("/executions/:id/start", async (req) => {
    return service.startExecution(req.params.id);
  });


  // COMPLETE EXECUTION
  fastify.post("/executions/:id/complete", async (req) => {

    fastify.validate({
      status: { required: true, enum: ["completed", "failed"] }
    }, req.body);

    return service.completeExecution(req.params.id, req.body.status);
  });


  // DELETE EXECUTION
  fastify.delete("/executions/:id", async (req) => {
    return service.deleteExecution(req.params.id);
  });

};
