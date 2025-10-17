const READ_KEYWORDS = new Set(["SELECT", "WITH"]);
const WRITE_KEYWORDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE"]);
const DDL_KEYWORDS = new Set(["CREATE", "ALTER", "DROP", "RENAME", "REINDEX", "VACUUM"]);

const IDENTIFIER_PATTERN = String.raw`(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)`;
const TABLE_TOKEN_PATTERN = new RegExp(`(${IDENTIFIER_PATTERN}\\.${IDENTIFIER_PATTERN})`, "g");
const TABLE_SEARCH_PATTERNS = [
  new RegExp(`\\bfrom\\s+(${IDENTIFIER_PATTERN}(?:\\.${IDENTIFIER_PATTERN})?)`, "gi"),
  new RegExp(`\\bjoin\\s+(${IDENTIFIER_PATTERN}(?:\\.${IDENTIFIER_PATTERN})?)`, "gi"),
  new RegExp(`\\bupdate\\s+(${IDENTIFIER_PATTERN}(?:\\.${IDENTIFIER_PATTERN})?)`, "gi"),
  new RegExp(`\\binto\\s+(${IDENTIFIER_PATTERN}(?:\\.${IDENTIFIER_PATTERN})?)`, "gi"),
  new RegExp(`\\bdelete\\s+from\\s+(${IDENTIFIER_PATTERN}(?:\\.${IDENTIFIER_PATTERN})?)`, "gi"),
  new RegExp(`\\btruncate\\s+table\\s+(${IDENTIFIER_PATTERN}(?:\\.${IDENTIFIER_PATTERN})?)`, "gi"),
];

export enum StatementCategory {
  READ = "read",
  WRITE = "write",
  DDL = "ddl",
  UNKNOWN = "unknown",
}

export class SQLValidationError extends Error {}

function splitQualifiedIdentifier(raw: string): string[] {
  const trimmed = raw.trim();
  const parts: string[] = [];
  let start = 0;
  let inQuotes = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === '"') {
      if (inQuotes && trimmed[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "." && !inQuotes) {
      parts.push(trimmed.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(trimmed.slice(start));
  return parts;
}

function normalizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/""/g, '"').toLowerCase();
  }
  return trimmed.toLowerCase();
}

function addReferenceTokens(rawToken: string, referenced: Map<string, boolean>): boolean {
  const segments = splitQualifiedIdentifier(rawToken);
  if (segments.length === 0) {
    return false;
  }

  if (segments.length > 1) {
    const normalizedSegments = segments.map(normalizeIdentifier);
    const tableName = normalizedSegments[normalizedSegments.length - 1];
    const schemaName = normalizedSegments.slice(0, -1).join(".");
    if (schemaName) {
      const token = `${schemaName}.${tableName}`;
      const existing = referenced.get(token);
      if (existing === undefined) {
        referenced.set(token, true);
      } else if (!existing) {
        referenced.set(token, true);
      }
    }
    return true;
  }

  const tableOnly = normalizeIdentifier(segments[0]);
  const token = `public.${tableOnly}`;
  if (!referenced.has(token)) {
    referenced.set(token, false);
  }
  return true;
}

export function enforceSingleStatement(sql: string): string {
  const stripped = sql.trim();
  if (stripped.length === 0) {
    throw new SQLValidationError("SQL statement must not be empty");
  }

  const body = stripped.endsWith(";") ? stripped.slice(0, -1) : stripped;
  if (body.includes(";")) {
    throw new SQLValidationError("Only single SQL statements are permitted");
  }
  return stripped.endsWith(";") ? stripped.slice(0, -1).trim() : stripped;
}

export function classifyStatement(sql: string): StatementCategory {
  const leading = sql.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? "";
  if (READ_KEYWORDS.has(leading)) {
    return StatementCategory.READ;
  }
  if (WRITE_KEYWORDS.has(leading)) {
    return StatementCategory.WRITE;
  }
  if (DDL_KEYWORDS.has(leading)) {
    return StatementCategory.DDL;
  }
  return StatementCategory.UNKNOWN;
}

export function validateAllowlist(sql: string, allowlist: string[]): void {
  const normalizedAllow = new Set(allowlist.map((entry) => entry.toLowerCase()));
  if (normalizedAllow.size === 0) {
    return;
  }

  const referenced = new Map<string, boolean>();
  let sawReference = false;
  for (const match of sql.matchAll(TABLE_TOKEN_PATTERN)) {
    if (addReferenceTokens(match[1], referenced)) {
      sawReference = true;
    }
  }
  for (const pattern of TABLE_SEARCH_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) {
      if (addReferenceTokens(match[1], referenced)) {
        sawReference = true;
      }
    }
  }

  if (!sawReference) {
    return;
  }

  const allowBare = new Set(Array.from(normalizedAllow).filter((entry) => !entry.includes(".")));
  const disallowed = Array.from(referenced.entries())
    .filter(([token, explicit]) => {
      if (normalizedAllow.has(token)) {
        return false;
      }
      const [schema, table] = token.includes(".") ? token.split(".", 2) : [undefined, token];
      if (allowBare.has(table) && (!explicit || schema === "public")) {
        return false;
      }
      return true;
    })
    .map(([token]) => token);

  if (disallowed.length > 0) {
    throw new SQLValidationError(
      `SQL references tables outside the allowlist: ${disallowed.join(", ")}`
    );
  }
}
