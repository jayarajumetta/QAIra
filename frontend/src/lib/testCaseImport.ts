import { parseCsvGrid } from "./csvGrid";

export type ImportedTestCaseRow = {
  title: string;
  action?: string;
  expected_result?: string;
  requirements?: string;
  requirement?: string;
  suites?: string;
  suite?: string;
  description?: string;
  priority?: number;
  status?: string;
  step_group_name?: string;
  step_group_kind?: string;
  shared_group_id?: string;
};

type ParsedCsv = {
  headers: string[];
  rows: ImportedTestCaseRow[];
  warnings: string[];
};

const HEADER_ALIASES: Record<keyof ImportedTestCaseRow, string[]> = {
  title: ["title", "testcasetitle", "testcase", "testcasename", "name"],
  action: ["action", "actions", "step", "steps", "teststep", "teststeps"],
  expected_result: ["expectedresult", "expectedresults", "expected", "result", "outcome"],
  requirements: ["requirements", "requirementtitles", "linkedrequirements"],
  requirement: ["requirement", "requirementtitle", "linkedrequirement"],
  suites: ["suites", "suitenames", "linkedsuites"],
  suite: ["suite", "suitename", "linkedsuite"],
  description: ["description", "details", "notes", "scenario"],
  priority: ["priority", "severity"],
  status: ["status", "state"],
  step_group_name: ["stepgroupname", "groupname", "sharedgroupname", "stepgroup", "group"],
  step_group_kind: ["stepgroupkind", "groupkind", "sharedgroupkind", "grouptype", "grouprole"],
  shared_group_id: ["sharedgroupid", "reusablegroupid", "stepgroupsourceid", "sharedgroupref"]
};

const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

const findCanonicalKey = (header: string) => {
  const normalized = normalizeHeader(header);

  return (Object.entries(HEADER_ALIASES) as Array<[keyof ImportedTestCaseRow, string[]]>).find(([, aliases]) =>
    aliases.includes(normalized)
  )?.[0];
};

export function parseTestCaseCsv(text: string): ParsedCsv {
  const grid = parseCsvGrid(text);

  if (!grid.length) {
    return {
      headers: [],
      rows: [],
      warnings: ["The CSV file is empty."]
    };
  }

  const headers = grid[0];
  const headerMap = headers.map((header) => findCanonicalKey(header));
  const rows = grid.slice(1);
  const warnings: string[] = [];

  if (!headerMap.includes("title")) {
    warnings.push("A title column is required. Supported aliases include Title or Test Case Title.");
  }

  const normalizedRows = rows
    .map((row) =>
      row.reduce<Partial<ImportedTestCaseRow>>((accumulator, value, index) => {
        const key = headerMap[index];

        if (!key || !value.trim()) {
          return accumulator;
        }

        if (key === "priority") {
          accumulator.priority = Number(value);
          return accumulator;
        }

        accumulator[key] = value.trim() as never;
        return accumulator;
      }, {})
    )
    .filter((row): row is ImportedTestCaseRow => Boolean(row.title?.trim()));

  if (!normalizedRows.length && rows.length) {
    warnings.push("No valid rows were found. Every imported row must include a test case title.");
  }

  return {
    headers,
    rows: normalizedRows,
    warnings
  };
}

const splitSequence = (value?: string) =>
  String(value || "")
    .split(/\r?\n|\|/)
    .map((item) => item.trim())
    .filter(Boolean);

const pickSequenceValue = (items: string[], index: number) => {
  if (!items.length) {
    return "";
  }

  if (index < items.length) {
    return items[index] || "";
  }

  return items.length === 1 ? items[0] || "" : "";
};

const normalizeImportedGroupKind = (value?: string) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");

  if (!normalized) {
    return "";
  }

  if (normalized === "reusable" || normalized === "shared" || normalized === "sharedgroup" || normalized === "snapshot") {
    return "reusable";
  }

  if (normalized === "local" || normalized === "grouped" || normalized === "group") {
    return "local";
  }

  return "";
};

const IMPORTED_ACTION_PREFIX_PATTERN = /^\[(shared|sharedgroup|shared steps|group|grouped|local)\s*:\s*([^\]]+)\]\s*(.*)$/i;

const parseAnnotatedActionLine = (value?: string) => {
  const raw = String(value || "").trim();

  if (!raw) {
    return {
      action: "",
      group_name: "",
      group_kind: ""
    };
  }

  const match = raw.match(IMPORTED_ACTION_PREFIX_PATTERN);

  if (!match) {
    return {
      action: raw,
      group_name: "",
      group_kind: ""
    };
  }

  const [, kindToken, groupName, actionBody] = match;
  const canonicalKind = normalizeImportedGroupKind(kindToken);

  return {
    action: String(actionBody || "").trim(),
    group_name: String(groupName || "").trim(),
    group_kind: canonicalKind
  };
};

export function buildImportedStepPreview(row: ImportedTestCaseRow) {
  const actions = splitSequence(row.action);
  const expectedResults = splitSequence(row.expected_result);
  const groupNames = splitSequence(row.step_group_name);
  const groupKinds = splitSequence(row.step_group_kind);
  const sharedGroupIds = splitSequence(row.shared_group_id);
  const size = Math.max(actions.length, expectedResults.length, groupNames.length, groupKinds.length, sharedGroupIds.length, 0);

  return Array.from({ length: size }, (_, index) => {
    const annotatedAction = parseAnnotatedActionLine(pickSequenceValue(actions, index));
    const legacyGroupName = pickSequenceValue(groupNames, index);
    const sharedGroupId = pickSequenceValue(sharedGroupIds, index);
    const resolvedGroupKind =
      annotatedAction.group_kind
      || normalizeImportedGroupKind(pickSequenceValue(groupKinds, index))
      || (sharedGroupId ? "reusable" : legacyGroupName ? "local" : "");
    const resolvedGroupName = annotatedAction.group_name || legacyGroupName;

    return {
      action: annotatedAction.action,
      expected_result: pickSequenceValue(expectedResults, index),
      step_group_name: resolvedGroupName,
      step_group_kind: resolvedGroupKind,
      shared_group_id: sharedGroupId
    };
  }).filter((step) => step.action || step.expected_result || step.step_group_name || step.shared_group_id);
}

export function countImportedSteps(row: ImportedTestCaseRow) {
  return buildImportedStepPreview(row).length;
}

export function countImportedGroups(row: ImportedTestCaseRow) {
  let previousSignature = "";
  let count = 0;

  buildImportedStepPreview(row).forEach((step) => {
    const signature =
      step.step_group_name || step.shared_group_id || step.step_group_kind
        ? `${step.step_group_kind || "local"}::${step.step_group_name || ""}::${step.shared_group_id || ""}`
        : "";

    if (signature && signature !== previousSignature) {
      count += 1;
    }

    previousSignature = signature;
  });

  return count;
}

export function getImportedStepPreviewLabel(row: ImportedTestCaseRow) {
  const firstStep = buildImportedStepPreview(row)[0];

  if (!firstStep) {
    return "No step content supplied";
  }

  const summary = firstStep.action || firstStep.expected_result || "Step";

  if (!firstStep.step_group_name) {
    return summary;
  }

  return `${summary} · ${firstStep.step_group_kind === "reusable" ? "Shared" : "Group"}: ${firstStep.step_group_name}`;
}
