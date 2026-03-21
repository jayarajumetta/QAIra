const service = require("../services/appType.service");

module.exports = async function (fastify) {

  // CREATE
  fastify.post("/app-types", async (req) => {

    fastify.validate({
      project_id: { required: true, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      type: { required: true, enum: ["web", "api", "android", "ios", "unified"] },
      is_unified: { required: false }
    }, req.body);

    return service.createAppType(req.body);
  });


  // GET ALL (optional filter by project)
  fastify.get("/app-types", async (req) => {
    const { project_id } = req.query;
    return service.getAppTypes(project_id);
  });


  // GET ONE
  fastify.get("/app-types/:id", async (req) => {
    return service.getAppType(req.params.id);
  });


  // UPDATE
  fastify.put("/app-types/:id", async (req) => {

    fastify.validate({
      name: { required: false, type: "string" },
      is_unified: { required: false }
    }, req.body);

    return service.updateAppType(req.params.id, req.body);
  });


  // DELETE
  fastify.delete("/app-types/:id", async (req) => {
    return service.deleteAppType(req.params.id);
  });

};