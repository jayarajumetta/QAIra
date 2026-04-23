export type ExecutionStepStatus = "passed" | "failed" | "blocked";

export type ExecutionStepEvidence = {
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
};

export type ExecutionApiAssertion = {
  kind: string;
  passed: boolean;
  target?: string | null;
  expected?: string | null;
  actual?: string | null;
};

export type ExecutionStepApiDetail = {
  step_id?: string;
  request?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string | null;
  };
  response?: {
    status?: number;
    status_text?: string;
    headers?: Record<string, string>;
    body?: string;
    json?: unknown;
  };
  captures?: Record<string, string>;
  assertions?: ExecutionApiAssertion[];
};

export type ExecutionLogsPayload = {
  stepStatuses?: Record<string, ExecutionStepStatus>;
  stepNotes?: Record<string, string>;
  stepEvidence?: Record<string, ExecutionStepEvidence>;
  stepApiDetails?: Record<string, ExecutionStepApiDetail>;
};

const isExecutionEvidenceDataUrl = (value: string) =>
  /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value.trim());

const normalizeStepEvidence = (value: unknown): Record<string, ExecutionStepEvidence> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, ExecutionStepEvidence>>((accumulator, [stepId, evidence]) => {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
      return accumulator;
    }

    const dataUrl = typeof (evidence as { dataUrl?: unknown }).dataUrl === "string"
      ? String((evidence as { dataUrl?: string }).dataUrl || "").trim()
      : "";

    if (!dataUrl || !isExecutionEvidenceDataUrl(dataUrl)) {
      return accumulator;
    }

    accumulator[stepId] = {
      dataUrl,
      fileName: typeof (evidence as { fileName?: unknown }).fileName === "string"
        ? String((evidence as { fileName?: string }).fileName || "").trim() || undefined
        : undefined,
      mimeType: typeof (evidence as { mimeType?: unknown }).mimeType === "string"
        ? String((evidence as { mimeType?: string }).mimeType || "").trim() || undefined
        : undefined
    };

    return accumulator;
  }, {});
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
      stepNotes: typeof payload.stepNotes === "object" && payload.stepNotes && !Array.isArray(payload.stepNotes) ? payload.stepNotes : {},
      stepEvidence: normalizeStepEvidence(payload.stepEvidence),
      stepApiDetails: typeof payload.stepApiDetails === "object" && payload.stepApiDetails && !Array.isArray(payload.stepApiDetails)
        ? payload.stepApiDetails
        : {}
    };
  } catch {
    return {};
  }
}

export function stringifyExecutionLogs(payload: ExecutionLogsPayload): string {
  return JSON.stringify({
    stepStatuses: payload.stepStatuses || {},
    stepNotes: payload.stepNotes || {},
    stepEvidence: payload.stepEvidence || {},
    stepApiDetails: payload.stepApiDetails || {}
  });
}

export function deriveCaseStatusFromSteps(
  stepIds: string[],
  stepStatuses: Record<string, ExecutionStepStatus>
): "running" | "passed" | "failed" | "blocked" {
  if (!stepIds.length) {
    return "passed";
  }

  if (Object.values(stepStatuses).some((status) => status === "failed")) {
    return "failed";
  }

  const allResolved = stepIds.every((id) => Boolean(stepStatuses[id]));
  if (!allResolved) {
    return Object.keys(stepStatuses).length ? "running" : "blocked";
  }

  return "passed";
}
