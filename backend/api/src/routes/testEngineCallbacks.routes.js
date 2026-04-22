const service = require("../services/testEngineCallback.service");

module.exports = async function (fastify) {
  fastify.post("/api/testengine/callbacks/runs", async (req) => {
    fastify.validate({
      engine_run_id: { required: true, type: "string" },
      qaira_run_id: { required: false, type: "string" },
      qaira_execution_id: { required: false, type: "string" },
      qaira_test_case_id: { required: true, type: "string" },
      event: { required: false, type: "string" },
      summary: { required: false, type: "string" },
      state: { required: false, type: "string" },
      emitted_at: { required: false, type: "string" },
      case_result: { required: false, type: "object" },
      artifact_bundle: { required: false, type: "object" }
    }, req.body);

    return service.handleRunCallback({
      headers: req.headers,
      payload: req.body
    });
  });
};
