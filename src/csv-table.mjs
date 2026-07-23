import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((value) => value !== ''));
}

export function stringifyCsv(headers, rows) {
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvField(row[header] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function readTable(filePath, headers) {
  if (!existsSync(filePath)) {
    return [];
  }

  const parsed = parseCsv(readFileSync(filePath, 'utf8'));
  if (parsed.length === 0) {
    return [];
  }

  const [actualHeaders, ...records] = parsed;
  const effectiveHeaders = actualHeaders.length > 0 ? actualHeaders : headers;
  return records.map((record) => {
    const row = {};
    effectiveHeaders.forEach((header, index) => {
      row[header] = record[index] ?? '';
    });
    for (const header of headers) {
      row[header] ??= '';
    }
    return row;
  });
}

export function writeTable(filePath, headers, rows) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, stringifyCsv(headers, rows), 'utf8');
}

function escapeCsvField(value) {
  const stringValue = String(value ?? '');
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}
