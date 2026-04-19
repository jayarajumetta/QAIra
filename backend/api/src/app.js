const fastify = require("fastify")({ 
  logger: true,
  requestIdLogLabel: "reqId",
  disableRequestLogging: false,
  requestTimeout: 30000
});

const cors = require("@fastify/cors");
const db = require("./db");
const { ensureRuntimeSchema } = require("./db/bootstrap");
const executionScheduleService = require("./services/executionSchedule.service");
const aiTestCaseGenerationService = require("./services/aiTestCaseGeneration.service");
const { verifyToken, generateRequestId } = require("./utils/token");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getCurrentUser = async (id) => {
  const user = await db.prepare(`
    SELECT id, email, name, avatar_data_url, auth_provider, email_verified, created_at
    FROM users
    WHERE id = ?
  `).get(id);

  if (!user) {
    return null;
  }

  const roleRow = await db.prepare(`
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

    if (rules.type === "object" && (typeof value !== "object" || Array.isArray(value))) {
      throw createError(`Field '${field}' must be an object`, 400);
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

  const user = await getCurrentUser(payload.sub);

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

// Add request ID to all requests
fastify.addHook("onRequest", async (req, reply) => {
  req.id = req.id || generateRequestId();
  reply.header("X-Request-ID", req.id);
  // Add security headers
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("X-XSS-Protection", "1; mode=block");
  reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});

// Improved CORS configuration
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["http://localhost:5173", "http://localhost:8080"];

fastify.register(cors, {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== "production") {
      cb(null, true);
    } else {
      cb(new Error("CORS not allowed"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400
});

fastify.register(require("./plugins/errorHandler"));
fastify.register(require("./routes"));
fastify.addHook("onReady", async () => {
  await ensureRuntimeSchema();
});

let scheduleProcessorTimer = null;
let aiGenerationProcessorTimer = null;

fastify.addHook("onReady", async () => {
  const runDueSchedules = async () => {
    try {
      await executionScheduleService.processDueSchedules();
    } catch (error) {
      fastify.log.error(error, "Unable to process due execution schedules");
    }
  };

  await runDueSchedules();
  scheduleProcessorTimer = setInterval(runDueSchedules, 60 * 1000);
});

fastify.addHook("onReady", async () => {
  const runQueuedAiGeneration = async () => {
    try {
      await aiTestCaseGenerationService.processQueuedJobs();
    } catch (error) {
      fastify.log.error(error, "Unable to process queued AI test case generation jobs");
    }
  };

  await runQueuedAiGeneration();
  aiGenerationProcessorTimer = setInterval(runQueuedAiGeneration, 15 * 1000);
});

fastify.addHook("onClose", async () => {
  if (scheduleProcessorTimer) {
    clearInterval(scheduleProcessorTimer);
    scheduleProcessorTimer = null;
  }

  if (aiGenerationProcessorTimer) {
    clearInterval(aiGenerationProcessorTimer);
    aiGenerationProcessorTimer = null;
  }
});

module.exports = fastify;
