import { buildAcceptedRun } from "./pipeline.js";
import {
  completeQueuedJobWithMetadata,
  executeQueuedApiStep,
  isQairaQueueConfigured,
  leaseNextQueuedJob,
  reportQueuedStep,
  startQueuedJob
} from "./qairaClient.js";
import { saveRun, updateRun } from "./runStore.js";
import { createWebRunSession } from "./webEngine.js";
import type { EngineQueuedJob } from "../contracts/qaira.js";
import { registerContextValue } from "./runtimeContext.js";

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

function syncCapturedValuesToWebContext(
  captures: Record<string, string> | undefined,
  webRunSession: ReturnType<typeof createWebRunSession> | null
) {
  if (!webRunSession || !captures) {
    return;
  }

  Object.entries(captures).forEach(([key, value]) => {
    registerContextValue(webRunSession.context, key, value);
  });
}

async function executeQueuedJob(job: EngineQueuedJob, workerId: string, logger: Logger) {
  const envelope = job.payload;
  const existingStatuses = job.runtime_state?.logs?.stepStatuses || {};
  const orderedSteps = envelope.steps.slice().sort((left, right) => left.order - right.order);
  const accepted = saveRun(buildAcceptedRun(envelope), envelope);
  const webRunSession = orderedSteps.some((step) => step.step_type === "web")
    ? createWebRunSession(envelope, job.runtime_state?.captured_values || {})
    : null;
  let healingAttempted = Boolean(job.runtime_state?.healing_attempted);
  let healingSucceeded = Boolean(job.runtime_state?.healing_succeeded);

  try {
    await startQueuedJob(job.id, workerId);
    updateRunState(accepted.id, "running", `Leased ${job.test_case_title} from QAira queue.`);

    const remainingSteps = orderedSteps.filter((step) => existingStatuses[step.id] !== "passed");

    if (!remainingSteps.length) {
      await completeQueuedJobWithMetadata(job.id, {
        status: "passed",
        summary: `${job.test_case_title} was already complete.`,
        deterministic_attempted: true,
        healing_attempted: healingAttempted,
        healing_succeeded: healingSucceeded
      });
      updateRunState(accepted.id, "completed", `${job.test_case_title} was already complete.`);
      return;
    }

    if (webRunSession) {
      await webRunSession.start();
    }

    for (const [index, step] of remainingSteps.entries()) {
      updateRunState(
        accepted.id,
        "running",
        `${job.test_case_title}: executing ${step.step_type.toUpperCase()} step ${index + 1} of ${remainingSteps.length}.`
      );

      if (step.step_type === "api") {
        const result = await executeQueuedApiStep(job.id, step.id);
        syncCapturedValuesToWebContext(result.captures, webRunSession);

        if (result.status === "failed") {
          const failureSummary = result.note || `${job.test_case_title} failed on step ${step.order}.`;
          updateRunState(accepted.id, "failed", failureSummary);
          await completeQueuedJobWithMetadata(job.id, {
            status: "failed",
            error: failureSummary,
            summary: failureSummary,
            deterministic_attempted: true,
            healing_attempted: healingAttempted,
            healing_succeeded: healingSucceeded
          });
          return;
        }

        continue;
      }

      if (step.step_type !== "web" || !webRunSession) {
        const message = `${job.test_case_title} includes unsupported step type ${step.step_type}.`;
        updateRunState(accepted.id, "failed", message);
        await completeQueuedJobWithMetadata(job.id, {
          status: "failed",
          error: message,
          summary: message,
          deterministic_attempted: true,
          healing_attempted: healingAttempted,
          healing_succeeded: healingSucceeded
        });
        return;
      }

      const stepResult = await webRunSession.runStep(step);
      healingAttempted = healingAttempted || stepResult.recovery_attempted;
      healingSucceeded = healingSucceeded || stepResult.recovery_succeeded;
      const report = await reportQueuedStep(job.id, step.id, {
        status: stepResult.status,
        note: stepResult.note,
        evidence: stepResult.evidence || null,
        captures: stepResult.captures,
        recovery_attempted: stepResult.recovery_attempted,
        recovery_succeeded: stepResult.recovery_succeeded
      });
      syncCapturedValuesToWebContext(report.captures, webRunSession);

      if (stepResult.status === "failed") {
        const failureSummary = stepResult.note || `${job.test_case_title} failed on step ${step.order}.`;
        updateRunState(accepted.id, "failed", failureSummary);
        await completeQueuedJobWithMetadata(job.id, {
          status: "failed",
          error: failureSummary,
          summary: failureSummary,
          deterministic_attempted: true,
          healing_attempted: healingAttempted,
          healing_succeeded: healingSucceeded
        });
        return;
      }
    }

    const completionSummary = `${job.test_case_title} completed successfully.`;
    await completeQueuedJobWithMetadata(job.id, {
      status: "passed",
      summary: completionSummary,
      deterministic_attempted: true,
      healing_attempted: healingAttempted,
      healing_succeeded: healingSucceeded
    });
    updateRunState(accepted.id, "completed", completionSummary);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${job.test_case_title} failed in queue worker.`;

    updateRunState(accepted.id, "failed", message);

    try {
      await completeQueuedJobWithMetadata(job.id, {
        status: "failed",
        error: message,
        summary: message,
        deterministic_attempted: true,
        healing_attempted: healingAttempted,
        healing_succeeded: healingSucceeded
      });
    } catch (reportError) {
      logger.error({ error: reportError, jobId: job.id }, "Unable to report queued job failure back to QAira");
    }
  } finally {
    if (webRunSession) {
      try {
        await webRunSession.stop();
      } catch (stopError) {
        logger.error({ error: stopError, jobId: job.id }, "Unable to stop web automation session cleanly");
      }
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
