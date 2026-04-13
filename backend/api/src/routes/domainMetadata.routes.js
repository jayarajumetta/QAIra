const service = require("../services/domainMetadata.service");

module.exports = async function (fastify) {
  fastify.get("/metadata/domain", async (req) => {
    await fastify.authenticate(req);
    return service.getDomainMetadata();
  });
};
