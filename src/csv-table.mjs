import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

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

export function* iterateTable(filePath, headers) {
  if (!existsSync(filePath)) {
    return;
  }

  const rows = iterateCsvFileRows(filePath);
  const first = rows.next();
  if (first.done) {
    return;
  }
  const effectiveHeaders = first.value.length > 0 ? first.value : headers;

  for (const record of rows) {
    const row = {};
    effectiveHeaders.forEach((header, index) => {
      row[header] = record[index] ?? '';
    });
    for (const header of headers) {
      row[header] ??= '';
    }
    yield row;
  }
}

function* iterateCsvFileRows(filePath) {
  const file = openSync(filePath, 'r');
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let row = [];
  let field = '';
  let inQuotes = false;
  let pendingQuote = false;

  try {
    for (const text of decodedFileChunks(file, buffer, decoder)) {
      for (const char of text) {
        if (inQuotes) {
          if (pendingQuote) {
            if (char === '"') {
              field += '"';
              pendingQuote = false;
              continue;
            }
            inQuotes = false;
            pendingQuote = false;
          } else if (char === '"') {
            pendingQuote = true;
            continue;
          } else {
            field += char;
            continue;
          }
        }

        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          row.push(field);
          field = '';
        } else if (char === '\n') {
          row.push(field);
          if (row.some((value) => value !== '')) {
            yield row;
          }
          row = [];
          field = '';
        } else if (char !== '\r') {
          field += char;
        }
      }
    }

    if (pendingQuote) {
      inQuotes = false;
      pendingQuote = false;
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      if (row.some((value) => value !== '')) {
        yield row;
      }
    }
  } finally {
    closeSync(file);
  }
}

function* decodedFileChunks(file, buffer, decoder) {
  while (true) {
    const bytesRead = readSync(file, buffer, 0, buffer.length, null);
    if (bytesRead === 0) {
      break;
    }
    yield decoder.write(buffer.subarray(0, bytesRead));
  }
  const tail = decoder.end();
  if (tail) {
    yield tail;
  }
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
