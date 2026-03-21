const service = require("../services/role.service");

module.exports = async function (fastify) {
  fastify.post("/roles", { preHandler: [fastify.requireAdmin] }, async (req) => {
    fastify.validate({
      name: { required: true, type: "string", minLength: 2 }
    }, req.body);

    return service.createRole(req.body);
  });

  fastify.get("/roles", { preHandler: [fastify.authenticate] }, async () => {
    return service.getRoles();
  });

  fastify.get("/roles/:id", { preHandler: [fastify.authenticate] }, async (req) => {
    return service.getRole(req.params.id);
  });

  fastify.put("/roles/:id", { preHandler: [fastify.requireAdmin] }, async (req) => {
    fastify.validate({
      name: { required: false, type: "string", minLength: 2 }
    }, req.body);

    return service.updateRole(req.params.id, req.body);
  });

  fastify.delete("/roles/:id", { preHandler: [fastify.requireAdmin] }, async (req) => {
    return service.deleteRole(req.params.id);
  });
};
