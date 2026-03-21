const service = require("../services/testSuite.service");

module.exports = async function (fastify) {
  fastify.post("/test-suites", async (req) => {
    fastify.validate({
      app_type_id: { required: true, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      parent_id: { required: false, type: "string" }
    }, req.body);

    return service.createTestSuite(req.body);
  });

  fastify.get("/test-suites", async (req) => {
    const { app_type_id, parent_id } = req.query;
    return service.getTestSuites({ app_type_id, parent_id });
  });

  fastify.get("/test-suites/:id", async (req) => {
    return service.getTestSuite(req.params.id);
  });

  fastify.put("/test-suites/:id", async (req) => {
    fastify.validate({
      name: { required: false, type: "string", minLength: 2 },
      parent_id: { required: false, type: "string" }
    }, req.body);

    return service.updateTestSuite(req.params.id, req.body);
  });

  fastify.delete("/test-suites/:id", async (req) => {
    return service.deleteTestSuite(req.params.id);
  });
};
