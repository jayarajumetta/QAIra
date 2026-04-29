const service = require("../services/executionResult.service");
const { EXECUTION_RESULT_STATUS_VALUES } = require("../domain/catalog");

module.exports = async function (fastify) {

  // CREATE RESULT
  fastify.post("/execution-results", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      execution_id: { required: true, type: "string" },
      test_case_id: { required: true, type: "string" },
      app_type_id: { required: true, type: "string" },
      status: { required: true, enum: EXECUTION_RESULT_STATUS_VALUES },
      duration_ms: { required: false, type: "number" },
      error: { required: false, type: "string" },
      logs: { required: false, type: "string" },
      external_references: { required: false, type: "array", items: "string" },
      defects: { required: false, type: "array", items: "string" },
      executed_by: { required: false, type: "string" }
    }, req.body);

    return service.createExecutionResult(req.body);
  });


  // GET RESULTS (FILTERABLE)
  fastify.get("/execution-results", async (req) => {
    await fastify.authenticate(req);

    const { execution_id, test_case_id, app_type_id } = req.query;

    return service.getExecutionResults({
      execution_id,
      test_case_id,
      app_type_id
    });
  });


  // GET SINGLE RESULT
  fastify.get("/execution-results/:id", async (req) => {
    await fastify.authenticate(req);
    return service.getExecutionResult(req.params.id);
  });


  // UPDATE RESULT
  fastify.put("/execution-results/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      status: { required: false, enum: EXECUTION_RESULT_STATUS_VALUES },
      duration_ms: { required: false, type: "number" },
      error: { required: false, type: "string" },
      logs: { required: false, type: "string" },
      external_references: { required: false, type: "array", items: "string" },
      defects: { required: false, type: "array", items: "string" }
    }, req.body);

    return service.updateExecutionResult(req.params.id, req.body);
  });


  // DELETE RESULT
  fastify.delete("/execution-results/:id", async (req) => {
    await fastify.authenticate(req);
    return service.deleteExecutionResult(req.params.id);
  });

};
