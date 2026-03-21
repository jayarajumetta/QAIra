const service = require("../services/requirementTestCase.service");

module.exports = async function (fastify) {
  fastify.get("/requirement-test-cases", async (req) => {
    const { requirement_id, test_case_id } = req.query;
    return service.listMappings({ requirement_id, test_case_id });
  });

  fastify.put("/requirement-test-cases/replace", async (req) => {
    fastify.validate({
      requirement_id: { required: true, type: "string" },
      test_case_ids: { required: true, type: "array", items: "string" }
    }, req.body);

    return service.replaceMappingsForRequirement(req.body.requirement_id, req.body.test_case_ids);
  });
};
