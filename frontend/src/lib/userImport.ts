import { parseCsvGrid } from "./csvGrid";

export type ImportedUserRow = {
  email: string;
  name?: string;
  password?: string;
  password_hash?: string;
  role?: string;
  role_id?: string;
};

type ParsedUserCsv = {
  headers: string[];
  rows: ImportedUserRow[];
  warnings: string[];
};

const HEADER_ALIASES: Record<keyof ImportedUserRow, string[]> = {
  email: ["email", "emailaddress", "useremail", "login"],
  name: ["name", "fullname", "displayname", "username"],
  password: ["password", "userpassword", "plainpassword"],
  password_hash: ["passwordhash", "password_hash", "hashedpassword"],
  role: ["role", "rolename", "userrole"],
  role_id: ["roleid", "role_id"]
};

const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

const findCanonicalKey = (header: string) => {
  const normalized = normalizeHeader(header);

  return (Object.entries(HEADER_ALIASES) as Array<[keyof ImportedUserRow, string[]]>).find(([, aliases]) =>
    aliases.includes(normalized)
  )?.[0];
};

export function parseUserCsv(text: string): ParsedUserCsv {
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

  if (!headerMap.includes("email")) {
    warnings.push("An email column is required. Supported aliases include Email or User Email.");
  }

  if (!headerMap.includes("password") && !headerMap.includes("password_hash")) {
    warnings.push("Include either a Password column or a Password Hash column for imported users.");
  }

  const normalizedRows = rows
    .map((row) =>
      row.reduce<Partial<ImportedUserRow>>((accumulator, value, index) => {
        const key = headerMap[index];

        if (!key || !value.trim()) {
          return accumulator;
        }

        accumulator[key] = value.trim() as never;
        return accumulator;
      }, {})
    )
    .filter((row): row is ImportedUserRow => Boolean(row.email?.trim()));

  if (!normalizedRows.length && rows.length) {
    warnings.push("No valid users were found. Every imported row must include an email address.");
  }

  return {
    headers,
    rows: normalizedRows,
    warnings
  };
}
