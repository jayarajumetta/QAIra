const service = require("../services/integration.service");

const sanitizeIntegration = (integration) => ({
  ...integration,
  api_key: null,
  config: {}
});

module.exports = async function (fastify) {
  fastify.post("/integrations", async (req) => {
    await fastify.requireAdmin(req);

    fastify.validate({
      type: { required: true, type: "string", enum: ["llm", "jira", "email", "google_auth"] },
      name: { required: true, type: "string", minLength: 2 },
      base_url: { required: false, type: "string" },
      api_key: { required: false, type: "string" },
      model: { required: false, type: "string" },
      project_key: { required: false, type: "string" },
      username: { required: false, type: "string" },
      config: { required: false, type: "object" },
      is_active: { required: false, type: "boolean" }
    }, req.body);

    return service.createIntegration(req.body);
  });

  fastify.get("/integrations", async (req) => {
    await fastify.authenticate(req);
    const { type, is_active } = req.query;

    const integrations = await service.getIntegrations({
      type,
      is_active: is_active !== undefined ? is_active === "true" : undefined
    });

    if (req.user.role === "admin") {
      return integrations;
    }

    return integrations
      .filter((integration) => integration.type === "llm" && integration.is_active)
      .map(sanitizeIntegration);
  });

  fastify.get("/integrations/:id", async (req) => {
    await fastify.requireAdmin(req);
    return service.getIntegration(req.params.id);
  });

  fastify.put("/integrations/:id", async (req) => {
    await fastify.requireAdmin(req);

    fastify.validate({
      type: { required: false, type: "string", enum: ["llm", "jira", "email", "google_auth"] },
      name: { required: false, type: "string", minLength: 2 },
      base_url: { required: false, type: "string" },
      api_key: { required: false, type: "string" },
      model: { required: false, type: "string" },
      project_key: { required: false, type: "string" },
      username: { required: false, type: "string" },
      config: { required: false, type: "object" },
      is_active: { required: false, type: "boolean" }
    }, req.body);

    return service.updateIntegration(req.params.id, req.body);
  });

  fastify.delete("/integrations/:id", async (req) => {
    await fastify.requireAdmin(req);
    return service.deleteIntegration(req.params.id);
  });
};
