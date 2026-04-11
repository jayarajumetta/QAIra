import { parseCsvGrid } from "./csvGrid";

export type ImportedTestCaseRow = {
  title: string;
  action?: string;
  expected_result?: string;
  step_group_name?: string;
  step_group_kind?: string;
  shared_group_id?: string;
  description?: string;
  priority?: number;
  status?: string;
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
  step_group_name: ["stepgroupname", "groupname", "sharedgroupname", "stepgroup", "group"],
  step_group_kind: ["stepgroupkind", "groupkind", "sharedgroupkind", "grouptype", "grouprole"],
  shared_group_id: ["sharedgroupid", "reusablegroupid", "stepgroupsourceid", "sharedgroupref"],
  description: ["description", "details", "notes", "scenario"],
  priority: ["priority", "severity"],
  status: ["status", "state"]
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
