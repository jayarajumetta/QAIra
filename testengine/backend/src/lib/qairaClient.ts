import type { EngineQueuedJob } from "../contracts/qaira.js";

const QAIRA_API_BASE_URL = String(process.env.QAIRA_API_BASE_URL || "").trim().replace(/\/+$/, "");
const QAIRA_TESTENGINE_SECRET = String(
  process.env.QAIRA_TESTENGINE_SECRET
  || process.env.TESTENGINE_SHARED_SECRET
  || "qaira-testengine-dev-secret"
).trim();
const ENGINE_PUBLIC_URL = String(process.env.ENGINE_PUBLIC_URL || process.env.ENGINE_HOST_URL || "")
  .trim()
  .replace(/\/+$/, "");

function ensureConfigured() {
  if (!QAIRA_API_BASE_URL) {
    throw new Error("QAIRA_API_BASE_URL is required for queue-pull mode");
  }

  if (!QAIRA_TESTENGINE_SECRET) {
    throw new Error("QAIRA_TESTENGINE_SECRET is required for queue-pull mode");
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  ensureConfigured();

  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${QAIRA_TESTENGINE_SECRET}`);

  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${QAIRA_API_BASE_URL}${path}`, {
    ...init,
    headers
  });
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();
  const payload = contentType.includes("application/json") && rawBody
    ? JSON.parse(rawBody)
    : null;

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload
      ? String((payload as { message?: unknown }).message || "")
      : "";
    throw new Error(message || `QAira internal API returned ${response.status}`);
  }

  return payload as T;
}

export function isQairaQueueConfigured() {
  return Boolean(QAIRA_API_BASE_URL && QAIRA_TESTENGINE_SECRET);
}

export async function leaseNextQueuedJob(workerId: string) {
  const response = await request<{ job: EngineQueuedJob | null }>("/testengine/internal/jobs/lease", {
    method: "POST",
    body: JSON.stringify({
      worker_id: workerId,
      engine_host: ENGINE_PUBLIC_URL || undefined
    })
  });

  return response.job;
}

export async function startQueuedJob(jobId: string, workerId: string) {
  return request<{ job_id: string; status: string; execution_result_id?: string | null }>(`/testengine/internal/jobs/${jobId}/start`, {
    method: "POST",
    body: JSON.stringify({
      worker_id: workerId
    })
  });
}

export async function executeQueuedApiStep(jobId: string, stepId: string) {
  return request<{
    job_id: string;
    step_id: string;
    status: "passed" | "failed";
    note: string;
    captures: Record<string, string>;
  }>(`/testengine/internal/jobs/${jobId}/steps/${stepId}/execute`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function reportQueuedStep(
  jobId: string,
  stepId: string,
  payload: {
    status: "passed" | "failed" | "blocked";
    note?: string;
    evidence?: {
      dataUrl: string;
      fileName?: string;
      mimeType?: string;
    } | null;
    api_detail?: Record<string, unknown> | null;
    web_detail?: unknown;
    captures?: Record<string, string>;
    recovery_attempted?: boolean;
    recovery_succeeded?: boolean;
  }
) {
  return request<{
    job_id: string;
    step_id: string;
    status: "passed" | "failed" | "blocked";
    case_status: "running" | "passed" | "failed" | "blocked";
    execution_result_id?: string | null;
    captures?: Record<string, string>;
  }>(`/testengine/internal/jobs/${jobId}/steps/${stepId}/report`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function completeQueuedJob(jobId: string, status?: "passed" | "failed" | "blocked", error?: string) {
  return request<{ job_id: string; status: string }>(`/testengine/internal/jobs/${jobId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      status,
      error
    })
  });
}

export async function completeQueuedJobWithMetadata(
  jobId: string,
  payload: {
    status?: "passed" | "failed" | "blocked";
    error?: string;
    summary?: string;
    deterministic_attempted?: boolean;
    healing_attempted?: boolean;
    healing_succeeded?: boolean;
    artifact_bundle?: Record<string, unknown> | null;
    patch_proposals?: Array<Record<string, unknown>>;
  }
) {
  return request<{ job_id: string; status: string }>(`/testengine/internal/jobs/${jobId}/complete`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function failQueuedJob(jobId: string, message: string) {
  return request<{ job_id: string; status: string }>(`/testengine/internal/jobs/${jobId}/fail`, {
    method: "POST",
    body: JSON.stringify({
      message
    })
  });
}
