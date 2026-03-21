module.exports = async function (fastify) {
    fastify.register(require("./auth.routes"));
    fastify.register(require("./users"));
    fastify.register(require("./roles.routes"));
    fastify.register(require("./projects.routes"));
    fastify.register(require("./projectMembers.routes"));
    fastify.register(require("./appTypes.routes"));
    fastify.register(require("./requirements.routes"));
    fastify.register(require("./testSuites.routes"));
    fastify.register(require("./testCases.routes"));
    fastify.register(require("./testSteps.routes"));
    fastify.register(require("./executions.routes"));
    fastify.register(require("./executionResults.routes"));
  };
