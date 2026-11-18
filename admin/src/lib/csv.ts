import type { ImportRowInput } from '@/api/types';

export const MAX_IMPORT_ROWS = 1000;

/** RFC 4180 parsing: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === '\t') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

/**
 * Turns CSV text into import rows. A header row naming `email` (and optionally `name`, `role`) sets the
 * column order; without one the columns are read as email, name, role.
 */
export function csvToImportRows(text: string): ImportRowInput[] {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const hasHeader = header.includes('email');
  const column = (name: string, fallback: number) => (hasHeader ? header.indexOf(name) : fallback);
  const emailAt = column('email', 0);
  const nameAt = column('name', 1);
  const roleAt = column('role', 2);
  const cell = (cells: string[], at: number) => (at >= 0 ? (cells[at] ?? '').trim() : '');

  return rows.slice(hasHeader ? 1 : 0).map((cells) => ({
    email: cell(cells, emailAt),
    name: cell(cells, nameAt),
    role: cell(cells, roleAt).toLowerCase() || 'member',
  }));
}
