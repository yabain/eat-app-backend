const DEV_DEFAULT_ORIGINS = ['http://localhost:4200', 'http://localhost:5173'];

const CORS_METHODS_LIST = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'] as const;

const CORS_HEADERS_BASE = [
  'Origin',
  'X-Requested-With',
  'Content-Type',
  'Accept',
  'Authorization',
] as const;

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Origines autorisées pour Access-Control-Allow-Origin (credentials: true → liste blanche stricte). */
export function buildCorsOrigins(): Set<string> {
  const fromEnv = [
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || '').split(','),
  ]
    .map((origin) => (origin ? normalizeOrigin(origin) : ''))
    .filter(Boolean);

  if (isProduction()) {
    return new Set(fromEnv);
  }

  return new Set([...fromEnv, ...DEV_DEFAULT_ORIGINS]);
}

export function assertCorsOriginsConfigured(origins: Set<string>): void {
  if (!isProduction() || origins.size > 0) return;

  console.error(
    '[CORS] En production, définissez FRONTEND_URL et/ou CORS_ORIGINS (origines séparées par des virgules).',
  );
  process.exit(1);
}

export const CORS_METHODS = CORS_METHODS_LIST.join(',');

export function corsAllowedHeaders(): string[] {
  const headers: string[] = [...CORS_HEADERS_BASE];
  if (!isProduction()) {
    headers.push('ngrok-skip-browser-warning');
  }
  return headers;
}
