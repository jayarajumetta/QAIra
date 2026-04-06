import * as XLSX from "xlsx";

type ParsedSpreadsheet = {
  columns: string[];
  rows: Array<Record<string, string>>;
  warnings: string[];
};

const INVALID_DATA_SET_CHAR_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const sanitizeCellValue = (value: unknown) =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(INVALID_DATA_SET_CHAR_PATTERN, "");

function makeUniqueHeaders(headers: string[]) {
  const seen = new Map<string, number>();

  return headers.map((header, index) => {
    const base = header.trim() || `Column ${index + 1}`;
    const nextCount = (seen.get(base) || 0) + 1;
    seen.set(base, nextCount);
    return nextCount === 1 ? base : `${base} ${nextCount}`;
  });
}

function normalizeGrid(grid: unknown[][]) {
  return grid
    .map((row) => row.map((cell) => sanitizeCellValue(cell)))
    .filter((row) => row.some((cell) => cell.trim().length));
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", dense: true });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return {
        columns: [],
        rows: [],
        warnings: ["The spreadsheet does not contain any sheets."]
      };
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false });
    const grid = normalizeGrid(rawGrid);

    if (!grid.length) {
      return {
        columns: [],
        rows: [],
        warnings: ["The spreadsheet is empty."]
      };
    }

    const warnings: string[] = [];
    const rawCsvText = XLSX.utils.sheet_to_csv(sheet);
    const sanitizedRawText = sanitizeCellValue(rawCsvText);

    if (rawCsvText !== sanitizedRawText) {
      warnings.push("Invalid control characters were removed while importing this spreadsheet.");
    }

    const columns = makeUniqueHeaders(grid[0]);
    const rows = grid
      .slice(1)
      .map((row) => {
        const normalizedRow: Record<string, string> = {};

        columns.forEach((column, index) => {
          normalizedRow[column] = sanitizeCellValue(row[index] ?? "");
        });

        return normalizedRow;
      })
      .filter((row) => Object.values(row).some((value) => value.trim()));

    if (rows.length) {
      return {
        columns,
        rows,
        warnings
      };
    }

    if (grid.length === 1) {
      const fallbackColumns = makeUniqueHeaders(grid[0].map((_, index) => `Column ${index + 1}`));
      const fallbackRows = [
        fallbackColumns.reduce<Record<string, string>>((accumulator, column, index) => {
          accumulator[column] = sanitizeCellValue(grid[0][index] ?? "");
          return accumulator;
        }, {})
      ];

      return {
        columns: fallbackColumns,
        rows: fallbackRows,
        warnings: [...warnings, "No header row was detected, so QAira generated column names automatically."]
      };
    }

    return {
      columns,
      rows: [],
      warnings: [...warnings, "The spreadsheet did not produce any populated data rows."]
    };
  } catch {
    throw new Error("Unable to read this spreadsheet. Upload a valid .xlsx, .xls, or .csv file with a readable first sheet.");
  }
}

export function toKeyValueRows(columns: string[], rows: Array<Record<string, string>>) {
  const normalizedColumns = columns.map((column) => column.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const keyColumn = columns[normalizedColumns.findIndex((column) => ["key", "name", "variable", "field"].includes(column))] || columns[0] || "key";
  const valueColumn = columns[normalizedColumns.findIndex((column) => ["value", "data", "content"].includes(column))] || columns[1] || columns[0] || "value";

  return rows
    .map((row) => ({
      key: sanitizeCellValue(row[keyColumn] ?? "").trim(),
      value: sanitizeCellValue(row[valueColumn] ?? "")
    }))
    .filter((row) => row.key);
}
