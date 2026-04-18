const settingsService = require("../services/settings.service");

module.exports = async function (fastify) {
  fastify.get("/settings/localization", async (req) => {
    await fastify.authenticate(req);
    return {
      strings: await settingsService.getLocalizationStrings()
    };
  });

  fastify.put("/settings/localization", async (req) => {
    await fastify.requireAdmin(req);

    fastify.validate({
      strings: { required: true, type: "object" }
    }, req.body);

    return settingsService.updateLocalizationStrings(req.body.strings);
  });
};
