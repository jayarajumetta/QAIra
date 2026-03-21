const service = require("../services/requirement.service");

module.exports = async function (fastify) {
  fastify.post("/requirements", async (req) => {
    fastify.validate({
      project_id: { required: true, type: "string" },
      title: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" }
    }, req.body);

    return service.createRequirement(req.body);
  });

  fastify.get("/requirements", async (req) => {
    const { project_id, status, priority } = req.query;
    return service.getRequirements({
      project_id,
      status,
      priority: priority !== undefined ? Number(priority) : undefined
    });
  });

  fastify.get("/requirements/:id", async (req) => {
    return service.getRequirement(req.params.id);
  });

  fastify.put("/requirements/:id", async (req) => {
    fastify.validate({
      project_id: { required: false, type: "string" },
      title: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" }
    }, req.body);

    return service.updateRequirement(req.params.id, req.body);
  });

  fastify.delete("/requirements/:id", async (req) => {
    return service.deleteRequirement(req.params.id);
  });
};
