module.exports = async function (fastify) {
  fastify.setErrorHandler((err, req, reply) => {
    const requestId = req.id || req.headers["x-request-id"] || "unknown";
    
    req.log.error({
      requestId,
      error: err.message,
      stack: err.stack,
      statusCode: err.statusCode || 500,
      method: req.method,
      url: req.url
    });

    const statusCode = err.statusCode || 500;
    const isDevelopment = process.env.NODE_ENV !== "production";

    reply.status(statusCode).send({
      success: false,
      message: err.message || "Internal Server Error",
      requestId,
      ...(isDevelopment && { stack: err.stack })
    });
  });
};