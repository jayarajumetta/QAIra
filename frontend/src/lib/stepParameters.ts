import type { ExecutionDataSetSnapshot, TestStep } from "../types";

export type StepParameterDefinition = {
  name: string;
  label: string;
  token: string;
  stepIds: string[];
  occurrenceCount: number;
};

export type StepParameterSegment =
  | {
      type: "text";
      value: string;
    }
  | {
      type: "token";
      token: string;
      name: string;
      label: string;
      resolvedValue: string | null;
    };

type StepParameterSource = Pick<TestStep, "id" | "action" | "expected_result">;

const STEP_PARAMETER_PATTERN = /(?<![A-Za-z0-9_])@([A-Za-z][A-Za-z0-9_-]*)/g;

export function normalizeStepParameterName(value?: string | null) {
  const trimmed = String(value || "").trim().replace(/^@+/, "");
  return trimmed ? trimmed.toLowerCase() : "";
}

export function extractStepParameterMatches(text?: string | null) {
  const source = String(text || "");

  if (!source) {
    return [];
  }

  return [...source.matchAll(STEP_PARAMETER_PATTERN)].map((match) => ({
    token: match[0],
    label: match[1],
    name: normalizeStepParameterName(match[1]),
    index: match.index || 0
  }));
}

export function collectStepParameters(steps: StepParameterSource[]): StepParameterDefinition[] {
  const parameterMap = new Map<string, StepParameterDefinition>();

  steps.forEach((step) => {
    [step.action, step.expected_result].forEach((value) => {
      extractStepParameterMatches(value).forEach((match) => {
        const current =
          parameterMap.get(match.name) || {
            name: match.name,
            label: match.label,
            token: `@${match.label}`,
            stepIds: [],
            occurrenceCount: 0
          };

        current.occurrenceCount += 1;

        if (!current.stepIds.includes(step.id)) {
          current.stepIds.push(step.id);
        }

        parameterMap.set(match.name, current);
      });
    });
  });

  return [...parameterMap.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function filterStepParameterValues(
  values: Record<string, string>,
  parameters: Array<Pick<StepParameterDefinition, "name">>
) {
  const allowed = new Set(parameters.map((parameter) => parameter.name));

  return Object.entries(values).reduce<Record<string, string>>((next, [key, value]) => {
    const normalizedKey = normalizeStepParameterName(key);

    if (!normalizedKey || !allowed.has(normalizedKey)) {
      return next;
    }

    next[normalizedKey] = value;
    return next;
  }, {});
}

export function buildDataSetParameterValues(dataSet?: ExecutionDataSetSnapshot | null) {
  const values: Record<string, string> = {};

  if (!dataSet?.rows?.length) {
    return values;
  }

  if (dataSet.mode === "key_value") {
    dataSet.rows.forEach((row) => {
      const key = normalizeStepParameterName(String(row.key ?? ""));

      if (!key) {
        return;
      }

      values[key] = String(row.value ?? "");
    });

    return values;
  }

  const firstRow = dataSet.rows.find((row) => row && typeof row === "object") || null;

  if (!firstRow) {
    return values;
  }

  Object.entries(firstRow).forEach(([column, value]) => {
    const key = normalizeStepParameterName(column);

    if (!key) {
      return;
    }

    values[key] = String(value ?? "");
  });

  return values;
}

export function mapStepParameterSegments(text?: string | null, values: Record<string, string> = {}): StepParameterSegment[] {
  const source = String(text || "");

  if (!source) {
    return [];
  }

  const segments: StepParameterSegment[] = [];
  let cursor = 0;

  extractStepParameterMatches(source).forEach((match) => {
    if (match.index > cursor) {
      segments.push({
        type: "text",
        value: source.slice(cursor, match.index)
      });
    }

    const resolvedValue = values[match.name];

    segments.push({
      type: "token",
      token: match.token,
      name: match.name,
      label: match.label,
      resolvedValue: resolvedValue === undefined ? null : resolvedValue
    });

    cursor = match.index + match.token.length;
  });

  if (cursor < source.length) {
    segments.push({
      type: "text",
      value: source.slice(cursor)
    });
  }

  return segments;
}

export function resolveStepParameterText(text?: string | null, values: Record<string, string> = {}) {
  if (!text) {
    return "";
  }

  return mapStepParameterSegments(text, values)
    .map((segment) => (segment.type === "text" ? segment.value : segment.resolvedValue ?? segment.token))
    .join("");
}
