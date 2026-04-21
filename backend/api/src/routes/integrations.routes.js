const service = require("../services/integration.service");
const { INTEGRATION_TYPE_VALUES } = require("../domain/catalog");

const sanitizeIntegration = (integration) => {
  const config = integration.config || {};

  if (integration.type === "google_drive") {
    return {
      ...integration,
      api_key: null,
      config: {
        project_id: config.project_id || null,
        folder_id: config.folder_id || null,
        schedule_mode: config.schedule_mode || "manual",
        last_synced_at: config.last_synced_at || null,
        last_sync_status: config.last_sync_status || null,
        last_sync_transaction_id: config.last_sync_transaction_id || null,
        last_sync_summary: config.last_sync_summary || null
      }
    };
  }

  if (integration.type === "github") {
    return {
      ...integration,
      api_key: null,
      config: {
        project_id: config.project_id || null,
        owner: config.owner || null,
        repo: config.repo || null,
        branch: config.branch || "main",
        directory: config.directory || "qaira-sync",
        schedule_mode: config.schedule_mode || "manual",
        last_synced_at: config.last_synced_at || null,
        last_sync_status: config.last_sync_status || null,
        last_sync_transaction_id: config.last_sync_transaction_id || null,
        last_sync_summary: config.last_sync_summary || null
      }
    };
  }

  return {
    ...integration,
    api_key: null,
    config: {}
  };
};

module.exports = async function (fastify) {
  fastify.post("/integrations", async (req) => {
    await fastify.requireAdmin(req);

    fastify.validate({
      type: { required: true, type: "string", enum: INTEGRATION_TYPE_VALUES },
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
      .filter((integration) => ["llm", "google_drive", "github"].includes(integration.type) && integration.is_active)
      .map(sanitizeIntegration);
  });

  fastify.get("/integrations/:id", async (req) => {
    await fastify.requireAdmin(req);
    return service.getIntegration(req.params.id);
  });

  fastify.put("/integrations/:id", async (req) => {
    await fastify.requireAdmin(req);

    fastify.validate({
      type: { required: false, type: "string", enum: INTEGRATION_TYPE_VALUES },
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
