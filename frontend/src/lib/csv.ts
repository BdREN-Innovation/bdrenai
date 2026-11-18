import { ImportRow } from "./portal";

export const MAX_IMPORT_ROWS = 1000;

/** Splits CSV text into records, honouring double-quoted fields with commas, newlines and "" escapes. */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => r.some((f) => f.trim() !== ""));
}

/**
 * Reads member rows from CSV. A header row naming an `email` column sets the column order;
 * without one the columns are email, name, role. An empty role means member.
 */
export function rowsFromCsv(text: string): ImportRow[] {
  const records = parseCsv(text.replace(/^\uFEFF/, ""));
  if (records.length === 0) return [];
  const header = records[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.includes("email");
  const col = (name: string, fallback: number) => (hasHeader ? header.indexOf(name) : fallback);
  const at = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : "");
  const email = col("email", 0);
  const name = col("name", 1);
  const role = col("role", 2);
  return records.slice(hasHeader ? 1 : 0).map((r) => ({
    email: at(r, email),
    name: at(r, name),
    role: at(r, role).toLowerCase() || "member",
  }));
}
