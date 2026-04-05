export type ExecutionStepStatus = "passed" | "failed" | "blocked";

export type ExecutionLogsPayload = {
  stepStatuses?: Record<string, ExecutionStepStatus>;
  stepNotes?: Record<string, string>;
};

export function parseExecutionLogs(logs: string | null): ExecutionLogsPayload {
  if (!logs?.trim()) {
    return {};
  }

  try {
    const payload = JSON.parse(logs) as ExecutionLogsPayload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {};
    }
    return {
      stepStatuses: typeof payload.stepStatuses === "object" && payload.stepStatuses && !Array.isArray(payload.stepStatuses)
        ? payload.stepStatuses
        : {},
      stepNotes: typeof payload.stepNotes === "object" && payload.stepNotes && !Array.isArray(payload.stepNotes) ? payload.stepNotes : {}
    };
  } catch {
    return {};
  }
}

export function stringifyExecutionLogs(payload: ExecutionLogsPayload): string {
  return JSON.stringify({
    stepStatuses: payload.stepStatuses || {},
    stepNotes: payload.stepNotes || {}
  });
}

export function deriveCaseStatusFromSteps(
  stepIds: string[],
  stepStatuses: Record<string, ExecutionStepStatus>
): "passed" | "failed" | "blocked" {
  if (!stepIds.length) {
    return "passed";
  }

  const allResolved = stepIds.every((id) => Boolean(stepStatuses[id]));
  if (!allResolved) {
    return "blocked";
  }

  return Object.values(stepStatuses).some((s) => s === "failed") ? "failed" : "passed";
}
