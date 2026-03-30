export type ImportedTestCaseRow = {
  title: string;
  action?: string;
  expected_result?: string;
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

const parseCsvGrid = (text: string) => {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === "\"") {
      if (inQuotes && nextCharacter === "\"") {
        currentCell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === ",") {
      currentRow.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentCell = "";
      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  if (currentCell || currentRow.length) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cell.trim().length));
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
