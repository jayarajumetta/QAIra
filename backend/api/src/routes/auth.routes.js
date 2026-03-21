const service = require("../services/auth.service");

const getBearerToken = (headers) => {
  const value = headers.authorization || "";

  if (!value.startsWith("Bearer ")) {
    throw new Error("Missing bearer token");
  }

  return value.slice("Bearer ".length);
};

module.exports = async function (fastify) {
  fastify.post("/auth/signup", async (req) => {
    fastify.validate({
      email: { required: true, type: "string", minLength: 3 },
      password: { required: true, type: "string", minLength: 6 },
      name: { required: false, type: "string" }
    }, req.body);

    return service.signup(req.body);
  });

  fastify.post("/auth/login", async (req) => {
    fastify.validate({
      email: { required: true, type: "string", minLength: 3 },
      password: { required: true, type: "string", minLength: 6 }
    }, req.body);

    return service.login(req.body);
  });

  fastify.get("/auth/session", async (req) => {
    const token = getBearerToken(req.headers);
    return service.getSession(token);
  });
};
