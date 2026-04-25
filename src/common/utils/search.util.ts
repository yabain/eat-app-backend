export function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildContainsRegex(input?: string) {
  if (!input) return undefined;
  const value = input.trim();
  if (!value) return undefined;
  return new RegExp(escapeRegex(value), 'i');
}

export function parseBooleanQuery(value?: string): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}
