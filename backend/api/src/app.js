const fastify = require("fastify")({ logger: true });

fastify.register(require("./plugins/errorHandler"));
fastify.register(require("./plugins/validator"));
fastify.register(require("./routes"));

module.exports = fastify;
