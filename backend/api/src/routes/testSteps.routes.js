const service = require("../services/testStep.service");

module.exports = async function (fastify) {
  fastify.post("/test-steps", async (req) => {
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      step_order: { required: true, type: "number" },
      action: { required: false, type: "string" },
      expected_result: { required: false, type: "string" }
    }, req.body);

    return service.createTestStep(req.body);
  });

  fastify.get("/test-steps", async (req) => {
    const { test_case_id } = req.query;
    return service.getTestSteps({ test_case_id });
  });

  fastify.get("/test-steps/:id", async (req) => {
    return service.getTestStep(req.params.id);
  });

  fastify.put("/test-steps/:id", async (req) => {
    fastify.validate({
      test_case_id: { required: false, type: "string" },
      step_order: { required: false, type: "number" },
      action: { required: false, type: "string" },
      expected_result: { required: false, type: "string" }
    }, req.body);

    return service.updateTestStep(req.params.id, req.body);
  });

  fastify.put("/test-cases/:id/test-steps/reorder", async (req) => {
    fastify.validate({
      step_ids: { required: true, type: "array", items: "string" }
    }, req.body);

    return service.reorderTestSteps(req.params.id, req.body.step_ids);
  });

  fastify.put("/test-steps/reorder", async (req) => {
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      step_ids: { required: true, type: "array", items: "string" }
    }, req.body);

    return service.reorderTestSteps(req.body.test_case_id, req.body.step_ids);
  });

  fastify.delete("/test-steps/:id", async (req) => {
    return service.deleteTestStep(req.params.id);
  });
};
