const service = require("../services/testCase.service");

module.exports = async function (fastify) {
  fastify.post("/test-cases", async (req) => {
    fastify.validate({
      title: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" },
      requirement_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      suite_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" }
    }, req.body);

    return service.createTestCase(req.body);
  });

  fastify.get("/test-cases", async (req) => {
    const { suite_id, requirement_id, status, app_type_id } = req.query;
    return service.getTestCases({ suite_id, requirement_id, status, app_type_id });
  });

  fastify.get("/test-cases/:id", async (req) => {
    return service.getTestCase(req.params.id);
  });

  fastify.put("/test-cases/:id", async (req) => {
    fastify.validate({
      title: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" },
      requirement_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      suite_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" }
    }, req.body);

    return service.updateTestCase(req.params.id, req.body);
  });

  fastify.delete("/test-cases/:id", async (req) => {
    return service.deleteTestCase(req.params.id);
  });
};
