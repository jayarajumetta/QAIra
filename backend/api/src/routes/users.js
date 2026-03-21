const service = require("../services/user.service");

module.exports = async function (fastify) {
  fastify.post("/users", { preHandler: [fastify.requireAdmin] }, async (req) => {
    fastify.validate({
      email: { required: true, type: "string", minLength: 3 },
      password_hash: { required: true, type: "string", minLength: 3 },
      name: { required: false, type: "string" },
      role_id: { required: true, type: "string" }
    }, req.body);

    return service.createUser(req.body);
  });

  fastify.get("/users", { preHandler: [fastify.authenticate] }, async () => {
    return service.getUsers();
  });

  fastify.get("/users/:id", { preHandler: [fastify.authenticate] }, async (req) => {
    return service.getUser(req.params.id);
  });

  fastify.put("/users/:id", { preHandler: [fastify.requireAdmin] }, async (req) => {
    fastify.validate({
      email: { required: false, type: "string", minLength: 3 },
      password_hash: { required: false, type: "string", minLength: 3 },
      name: { required: false, type: "string" },
      role_id: { required: false, type: "string" }
    }, req.body);

    return service.updateUser(req.params.id, req.body);
  });

  fastify.delete("/users/:id", { preHandler: [fastify.requireAdmin] }, async (req) => {
    return service.deleteUser(req.params.id);
  });
};
