import Fastify from "fastify";
import { buildAcceptedRun, buildCapabilities } from "./lib/pipeline.js";
import { queueRunExecution, saveAcceptedRun } from "./lib/executor.js";
import { createOpsTelemetry } from "./lib/opsTelemetry.js";
import { startQueueWorker } from "./lib/queueWorker.js";
import { getRun, getRunEnvelope, listRuns, saveRun } from "./lib/runStore.js";
import type { EngineRunEnvelope } from "./contracts/qaira.js";

const port = Number.parseInt(process.env.PORT || "4301", 10);
const normalizeText = (value: unknown) => {
  const normalized = String(value || "").trim();
  return normalized || "";
};
const buildSeleniumLiveViewUrl = () => {
  const configured = normalizeText(process.env.SELENIUM_LIVE_VIEW_URL || process.env.SELENIUM_VNC_URL);

  if (configured) {
    return configured;
  }

  const publicBase = normalizeText(process.env.ENGINE_PUBLIC_URL);

  if (!publicBase) {
    return null;
  }

  try {
    const parsed = new URL(publicBase);
    parsed.port = normalizeText(process.env.SELENIUM_VNC_PORT) || "7900";
    parsed.pathname = "/";
    parsed.search = "?autoconnect=1&resize=scale";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info"
  }
});
const opsTelemetry = await createOpsTelemetry(app.log);

await opsTelemetry.register(app);

app.get("/health", async () => ({
  ok: true,
  service: process.env.ENGINE_NAME || "QAira Test Engine",
  runner: "hybrid",
  ui: "qaira",
  execution_scope: "api+web",
  supported_web_engines: ["playwright", "selenium"],
  ops_telemetry: opsTelemetry.getHealthSnapshot()
}));

app.get("/api/v1/capabilities", async () => buildCapabilities());

app.get("/api/v1/live-session", async () => ({
  ok: true,
  provider: "selenium",
  available: Boolean(buildSeleniumLiveViewUrl()),
  live_view_url: buildSeleniumLiveViewUrl(),
  selenium_grid_url: process.env.SELENIUM_GRID_URL || "http://selenium-hub:4444/wd/hub",
  note: "Use the live_view_url while a Selenium web run is active."
}));

app.get("/api/v1/runs", async () => ({
  items: listRuns()
}));

app.get("/api/v1/runs/:id", async (request, reply) => {
  const params = request.params as { id: string };
  const run = getRun(params.id);

  if (!run) {
    reply.code(404);
    return { message: "Run not found" };
  }

  return run;
});

app.post("/api/v1/runs", async (request, reply) => {
  const envelope = request.body as EngineRunEnvelope;

  if (!envelope?.engine_run_id || !envelope?.qaira_run_id || !envelope?.qaira_test_case_id) {
    reply.code(400);
    return { message: "engine_run_id, qaira_run_id, and qaira_test_case_id are required" };
  }

  if (!envelope.automated) {
    reply.code(400);
    return { message: "Test Engine only accepts automated run handoff requests" };
  }

  if (!envelope.callback?.url || !envelope.callback?.signing_secret) {
    reply.code(400);
    return { message: "callback.url and callback.signing_secret are required" };
  }

  const accepted = saveAcceptedRun(envelope, buildAcceptedRun(envelope));
  queueRunExecution(envelope, accepted, app.log);
  reply.code(202);
  return {
    id: accepted.id,
    state: accepted.state,
    summary: accepted.summary
  };
});

app.post("/api/v1/runs/:id/retry", async (request, reply) => {
  const params = request.params as { id: string };
  const existing = getRun(params.id);

  if (!existing) {
    reply.code(404);
    return { message: "Run not found" };
  }

  const envelope = getRunEnvelope(params.id);

  if (!envelope) {
    reply.code(409);
    return { message: "Run handoff payload is no longer available for retry" };
  }

  const retried = saveRun({
    ...existing,
    state: "running",
    healing_attempted: false,
    healing_succeeded: false,
    summary: "Retry requested. Deterministic engine execution will run before any healing attempt.",
    updated_at: new Date().toISOString()
  }, envelope);

  queueRunExecution(envelope, retried, app.log);

  reply.code(202);
  return retried;
});

startQueueWorker(app.log);

app.listen({
  port,
  host: "0.0.0.0"
}).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
