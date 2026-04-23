const service = require("../services/testEngineDispatch.service");

module.exports = async function (fastify) {
  fastify.post("/testengine/internal/jobs/lease", async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      worker_id: { required: false, type: "string" },
      engine_host: { required: false, type: "string" },
      lease_seconds: { required: false, type: "number" }
    }, req.body || {});

    const job = await service.leaseNextQueuedJob(req.body || {});
    return { job };
  });

  fastify.get("/testengine/internal/jobs/:id", async (req) => {
    await fastify.authenticateTestEngine(req);
    return service.getQueuedJob(req.params.id);
  });

  fastify.post("/testengine/internal/jobs/:id/start", async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      worker_id: { required: false, type: "string" }
    }, req.body || {});

    return service.startQueuedJob({
      job_id: req.params.id,
      worker_id: req.body?.worker_id
    });
  });

  fastify.post("/testengine/internal/jobs/:id/steps/:stepId/execute", async (req) => {
    await fastify.authenticateTestEngine(req);

    return service.executeQueuedApiStep({
      job_id: req.params.id,
      step_id: req.params.stepId
    });
  });

  fastify.post("/testengine/internal/jobs/:id/complete", async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      status: { required: false, type: "string" },
      error: { required: false, type: "string" }
    }, req.body || {});

    return service.completeQueuedJob({
      job_id: req.params.id,
      status: req.body?.status,
      error: req.body?.error
    });
  });

  fastify.post("/testengine/internal/jobs/:id/fail", async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      message: { required: false, type: "string" }
    }, req.body || {});

    return service.failQueuedJob({
      job_id: req.params.id,
      message: req.body?.message
    });
  });
};
