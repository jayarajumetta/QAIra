const service = require("../services/role.service");

module.exports = async function (fastify) {
  fastify.post("/roles", async (req) => {
    fastify.validate({
      name: { required: true, type: "string", minLength: 2 }
    }, req.body);

    return service.createRole(req.body);
  });

  fastify.get("/roles", async () => {
    return service.getRoles();
  });

  fastify.get("/roles/:id", async (req) => {
    return service.getRole(req.params.id);
  });

  fastify.put("/roles/:id", async (req) => {
    fastify.validate({
      name: { required: false, type: "string", minLength: 2 }
    }, req.body);

    return service.updateRole(req.params.id, req.body);
  });

  fastify.delete("/roles/:id", async (req) => {
    return service.deleteRole(req.params.id);
  });
};
