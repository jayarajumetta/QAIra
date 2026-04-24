const QAIRA_API_BASE_URL = String(process.env.QAIRA_API_BASE_URL || "").trim().replace(/\/+$/, "");
const QAIRA_TESTENGINE_SECRET = String(process.env.QAIRA_TESTENGINE_SECRET
    || process.env.TESTENGINE_SHARED_SECRET
    || "qaira-testengine-dev-secret").trim();
const ENGINE_PUBLIC_URL = String(process.env.ENGINE_PUBLIC_URL || process.env.ENGINE_HOST_URL || "").trim();
function ensureConfigured() {
    if (!QAIRA_API_BASE_URL) {
        throw new Error("QAIRA_API_BASE_URL is required for queue-pull mode");
    }
    if (!QAIRA_TESTENGINE_SECRET) {
        throw new Error("QAIRA_TESTENGINE_SECRET is required for queue-pull mode");
    }
}
async function request(path, init) {
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
            ? String(payload.message || "")
            : "";
        throw new Error(message || `QAira internal API returned ${response.status}`);
    }
    return payload;
}
export function isQairaQueueConfigured() {
    return Boolean(QAIRA_API_BASE_URL && QAIRA_TESTENGINE_SECRET);
}
export async function leaseNextQueuedJob(workerId) {
    const response = await request("/testengine/internal/jobs/lease", {
        method: "POST",
        body: JSON.stringify({
            worker_id: workerId,
            engine_host: ENGINE_PUBLIC_URL || undefined
        })
    });
    return response.job;
}
export async function startQueuedJob(jobId, workerId) {
    return request(`/testengine/internal/jobs/${jobId}/start`, {
        method: "POST",
        body: JSON.stringify({
            worker_id: workerId
        })
    });
}
export async function executeQueuedApiStep(jobId, stepId) {
    return request(`/testengine/internal/jobs/${jobId}/steps/${stepId}/execute`, {
        method: "POST",
        body: JSON.stringify({})
    });
}
export async function reportQueuedStep(jobId, stepId, payload) {
    return request(`/testengine/internal/jobs/${jobId}/steps/${stepId}/report`, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}
export async function completeQueuedJob(jobId, status, error) {
    return request(`/testengine/internal/jobs/${jobId}/complete`, {
        method: "POST",
        body: JSON.stringify({
            status,
            error
        })
    });
}
export async function completeQueuedJobWithMetadata(jobId, payload) {
    return request(`/testengine/internal/jobs/${jobId}/complete`, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}
export async function failQueuedJob(jobId, message) {
    return request(`/testengine/internal/jobs/${jobId}/fail`, {
        method: "POST",
        body: JSON.stringify({
            message
        })
    });
}
