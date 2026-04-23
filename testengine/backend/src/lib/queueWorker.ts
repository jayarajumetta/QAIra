import { buildAcceptedRun } from "./pipeline.js";
import {
  completeQueuedJob,
  executeQueuedApiStep,
  failQueuedJob,
  isQairaQueueConfigured,
  leaseNextQueuedJob,
  startQueuedJob
} from "./qairaClient.js";
import { saveRun, updateRun } from "./runStore.js";
import type { EngineQueuedJob } from "../contracts/qaira.js";

type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
};

const POLL_INTERVAL_MS = Math.max(750, Number(process.env.TESTENGINE_POLL_INTERVAL_MS || 1500));
const POLL_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.TESTENGINE_POLL_CONCURRENCY || 1)));

const nowIso = () => new Date().toISOString();

function updateRunState(runId: string, state: "queued" | "running" | "completed" | "failed" | "incident", summary: string) {
  updateRun(runId, (current) => ({
    ...current,
    state,
    summary,
    updated_at: nowIso()
  }));
}

async function executeQueuedJob(job: EngineQueuedJob, workerId: string, logger: Logger) {
  const envelope = job.payload;
  const existingStatuses = job.runtime_state?.logs?.stepStatuses || {};
  const orderedSteps = envelope.steps.slice().sort((left, right) => left.order - right.order);
  const accepted = saveRun(buildAcceptedRun(envelope), envelope);

  try {
    await startQueuedJob(job.id, workerId);
    updateRunState(accepted.id, "running", `Leased ${job.test_case_title} from QAira queue.`);

    if (orderedSteps.some((step) => step.step_type !== "api")) {
      const message = "API-first queue worker only supports API steps in this runtime.";
      updateRunState(accepted.id, "failed", message);
      await failQueuedJob(job.id, message);
      return;
    }

    const remainingSteps = orderedSteps.filter((step) => existingStatuses[step.id] !== "passed");

    if (!remainingSteps.length) {
      await completeQueuedJob(job.id, "passed");
      updateRunState(accepted.id, "completed", `${job.test_case_title} was already complete.`);
      return;
    }

    for (const [index, step] of remainingSteps.entries()) {
      updateRunState(
        accepted.id,
        "running",
        `${job.test_case_title}: executing API step ${index + 1} of ${remainingSteps.length}.`
      );

      const result = await executeQueuedApiStep(job.id, step.id);

      if (result.status === "failed") {
        updateRunState(accepted.id, "failed", result.note || `${job.test_case_title} failed on step ${step.order}.`);
        await failQueuedJob(job.id, result.note || `${job.test_case_title} failed on step ${step.order}.`);
        return;
      }
    }

    await completeQueuedJob(job.id, "passed");
    updateRunState(accepted.id, "completed", `${job.test_case_title} completed successfully.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${job.test_case_title} failed in queue worker.`;

    updateRunState(accepted.id, "failed", message);

    try {
      await failQueuedJob(job.id, message);
    } catch (reportError) {
      logger.error({ error: reportError, jobId: job.id }, "Unable to report queued job failure back to QAira");
    }
  }
}

export function startQueueWorker(logger: Logger) {
  if (!isQairaQueueConfigured()) {
    logger.info("QAira queue pull mode is disabled because QAIRA_API_BASE_URL is not configured.");
    return;
  }

  const activeJobs = new Set<string>();
  let isPolling = false;

  const poll = async () => {
    if (isPolling) {
      return;
    }

    isPolling = true;

    try {
      while (activeJobs.size < POLL_CONCURRENCY) {
        const workerId = `${process.env.ENGINE_NAME || "qaira-testengine"}:${process.pid}:${activeJobs.size + 1}`;
        const job = await leaseNextQueuedJob(workerId);

        if (!job || activeJobs.has(job.id)) {
          break;
        }

        activeJobs.add(job.id);

        void executeQueuedJob(job, workerId, logger)
          .catch((error) => {
            logger.error({ error, jobId: job.id }, "Queued job execution crashed");
          })
          .finally(() => {
            activeJobs.delete(job.id);
          });
      }
    } catch (error) {
      logger.error({ error }, "Unable to poll QAira queued jobs");
    } finally {
      isPolling = false;
    }
  };

  void poll();
  setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);
}
