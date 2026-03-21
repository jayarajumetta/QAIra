const fastify = require("fastify")({ logger: true });
const cors = require("@fastify/cors");

fastify.decorate("validate", (schema, data = {}) => {
  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    const isMissing = value === undefined || value === null;

    if (rules.required && isMissing) {
      throw new Error(`Field '${field}' is required`);
    }

    if (isMissing) {
      continue;
    }

    if (rules.type === "string" && typeof value !== "string") {
      throw new Error(`Field '${field}' must be a string`);
    }

    if (rules.type === "number" && typeof value !== "number") {
      throw new Error(`Field '${field}' must be a number`);
    }

    if (rules.type === "boolean" && typeof value !== "boolean") {
      throw new Error(`Field '${field}' must be a boolean`);
    }

    if (rules.minLength && typeof value === "string" && value.length < rules.minLength) {
      throw new Error(`Field '${field}' must be at least ${rules.minLength} characters`);
    }

    if (rules.enum && !rules.enum.includes(value)) {
      throw new Error(`Field '${field}' must be one of: ${rules.enum.join(", ")}`);
    }
  }
});

fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
});
fastify.register(require("./plugins/errorHandler"));
fastify.register(require("./routes"));

module.exports = fastify;
