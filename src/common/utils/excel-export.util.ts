import * as XLSX from 'xlsx';

function normalizeExcelValue(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof (value as any)?.toHexString === 'function') return (value as any).toHexString();
  return JSON.stringify(value);
}

export function buildExcelExport(
  documents: Record<string, unknown>[],
  sheetName: string,
  excludedFields: string[] = [],
): Buffer {
  const excluded = new Set([...excludedFields, '__v']);
  const rows = documents.map((document) =>
    Object.fromEntries(
      Object.entries(document)
        .filter(([key]) => !excluded.has(key))
        .map(([key, value]) => [key, normalizeExcelValue(value)]),
    ),
  );

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  worksheet['!cols'] = headers.map((header) => ({
    wch: Math.min(
      60,
      Math.max(
        header.length + 2,
        ...rows.map((row) => String(row[header] ?? '').length + 2),
      ),
    ),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
