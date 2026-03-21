module.exports = async function (fastify) {
    fastify.setErrorHandler((err, req, reply) => {
      req.log.error(err);
  
      reply.status(err.statusCode || 500).send({
        success: false,
        message: err.message || "Internal Server Error"
      });
    });
  };