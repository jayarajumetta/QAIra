const fastify = require("fastify")({ logger: true });
const cors = require("@fastify/cors");
const db = require("./db");
const { verifyToken } = require("./utils/token");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getCurrentUser = (id) => {
  const user = db.prepare(`
    SELECT id, email, name, created_at
    FROM users
    WHERE id = ?
  `).get(id);

  if (!user) {
    return null;
  }

  const roleRow = db.prepare(`
    SELECT roles.name
    FROM project_members
    JOIN roles ON roles.id = project_members.role_id
    WHERE project_members.user_id = ?
    ORDER BY CASE roles.name WHEN 'admin' THEN 0 ELSE 1 END
    LIMIT 1
  `).get(id);

  return {
    ...user,
    role: roleRow?.name === "admin" ? "admin" : "member"
  };
};

fastify.decorate("validate", (schema, data = {}) => {
  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    const isMissing = value === undefined || value === null;

    if (rules.required && isMissing) {
      throw createError(`Field '${field}' is required`, 400);
    }

    if (isMissing) {
      continue;
    }

    if (rules.type === "string" && typeof value !== "string") {
      throw createError(`Field '${field}' must be a string`, 400);
    }

    if (rules.type === "number" && typeof value !== "number") {
      throw createError(`Field '${field}' must be a number`, 400);
    }

    if (rules.type === "boolean" && typeof value !== "boolean") {
      throw createError(`Field '${field}' must be a boolean`, 400);
    }

    if (rules.type === "array" && !Array.isArray(value)) {
      throw createError(`Field '${field}' must be an array`, 400);
    }

    if (rules.type === "array" && rules.items === "string" && !value.every((item) => typeof item === "string")) {
      throw createError(`Field '${field}' must contain only strings`, 400);
    }

    if (rules.minLength && typeof value === "string" && value.length < rules.minLength) {
      throw createError(`Field '${field}' must be at least ${rules.minLength} characters`, 400);
    }

    if (rules.enum && !rules.enum.includes(value)) {
      throw createError(`Field '${field}' must be one of: ${rules.enum.join(", ")}`, 400);
    }
  }
});

fastify.decorateRequest("user", null);

fastify.decorate("authenticate", async (req) => {
  const value = req.headers.authorization || "";

  if (!value.startsWith("Bearer ")) {
    throw createError("Missing bearer token", 401);
  }

  let payload;

  try {
    payload = verifyToken(value.slice("Bearer ".length));
  } catch (error) {
    throw createError(error.message || "Invalid token", 401);
  }

  const user = getCurrentUser(payload.sub);

  if (!user) {
    throw createError("User not found", 404);
  }

  req.user = user;
});

fastify.decorate("requireAdmin", async (req) => {
  await fastify.authenticate(req);

  if (req.user.role !== "admin") {
    throw createError("Admin access required", 403);
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
