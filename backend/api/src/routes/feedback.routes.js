const service = require("../services/feedback.service");

module.exports = async function (fastify) {
  fastify.post("/feedback", async (req) => {
    fastify.validate({
      user_id: { required: true, type: "string" },
      title: { required: true, type: "string", minLength: 2 },
      message: { required: true, type: "string", minLength: 2 },
      status: { required: false, type: "string" }
    }, req.body);

    return service.createFeedback(req.body);
  });

  fastify.get("/feedback", async (req) => {
    const { user_id, status } = req.query;
    return service.getFeedback({ user_id, status });
  });

  fastify.get("/feedback/:id", async (req) => {
    return service.getFeedbackItem(req.params.id);
  });

  fastify.put("/feedback/:id", async (req) => {
    fastify.validate({
      user_id: { required: false, type: "string" },
      title: { required: false, type: "string", minLength: 2 },
      message: { required: false, type: "string", minLength: 2 },
      status: { required: false, type: "string" }
    }, req.body);

    return service.updateFeedback(req.params.id, req.body);
  });

  fastify.delete("/feedback/:id", async (req) => {
    return service.deleteFeedback(req.params.id);
  });
};
