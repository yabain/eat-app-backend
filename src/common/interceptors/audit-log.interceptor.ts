import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const SENSITIVE_FIELDS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'credential',
  'apiKey',
  'secret',
]);

// Endpoints qu'on évite de logger car trop bruyants ou sensibles.
const SKIP_LOG_PATTERNS: RegExp[] = [
  /\/auth\/refresh\b/i,
  /\/auth\/forgot-password\b/i,
  /\/auth\/reset-password\b/i,
  /\/payments\/webhook\b/i,
  /\/tracking\/visit\b/i,
];

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditLogs: AuditLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const method = req.method as string;

    if (!MUTATING_METHODS.has(method)) return next.handle();
    if (SKIP_LOG_PATTERNS.some((re) => re.test(req.url || ''))) return next.handle();

    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: (response) => {
          // Fire-and-forget : on ne bloque jamais la réponse métier.
          this.persist(req, response, http.getResponse()?.statusCode, Date.now() - startedAt).catch(() => undefined);
        },
        error: (err) => {
          this.persist(req, null, err?.status || 500, Date.now() - startedAt, err).catch(() => undefined);
        },
      }),
    );
  }

  private async persist(req: any, response: any, statusCode: number, durationMs: number, error?: any) {
    const path: string = this.extractApiPath(req.originalUrl || req.url || '');
    const { action, resourceType, resourceId } = this.parseAction(req.method, path);

    const actor = req.user || {};
    const metadata: Record<string, any> = {};

    const sanitizedBody = this.sanitize(req.body);
    if (sanitizedBody && Object.keys(sanitizedBody).length > 0) metadata.requestBody = sanitizedBody;

    if (response !== null && response !== undefined) {
      const summary = this.summarizeResponse(response);
      if (summary) metadata.responseSummary = summary;
    }

    if (error) {
      metadata.error = {
        name: error?.name,
        message: error?.message,
        status: error?.status,
      };
    }

    await this.auditLogs.record({
      actorId: actor?.sub || null,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      action,
      resourceType,
      resourceId,
      resourceLabel: this.extractResourceLabel(response),
      metadata: Object.keys(metadata).length ? metadata : undefined,
      method: req.method,
      path,
      statusCode,
      durationMs,
      ip: this.extractIp(req),
      userAgent: req.headers?.['user-agent'],
    });
  }

  private extractApiPath(url: string): string {
    const noQuery = (url || '').split('?')[0];
    const apiIdx = noQuery.indexOf('/api/');
    return apiIdx >= 0 ? noQuery.slice(apiIdx + 4) : noQuery;
  }

  private parseAction(method: string, path: string): { action: string; resourceType?: string; resourceId?: string } {
    // Découpe le chemin "/categories/665a.../activate" → segments ["categories", "665a...", "activate"]
    const segments = path.replace(/^\//, '').split('/').filter(Boolean);
    if (!segments.length) return { action: `${method.toLowerCase()}.unknown` };

    const resourceType = singularize(segments[0]);
    let resourceId: string | undefined;
    let verbSegment: string | undefined;

    // Pattern courant: /<resource>/<id>/<verb>
    if (segments.length >= 3 && isLikelyObjectId(segments[1])) {
      resourceId = segments[1];
      verbSegment = segments.slice(2).join('_');
    } else if (segments.length === 2 && isLikelyObjectId(segments[1])) {
      resourceId = segments[1];
      verbSegment = undefined;
    } else if (segments.length >= 2 && !isLikelyObjectId(segments[1])) {
      verbSegment = segments.slice(1).join('_');
    }

    const verb = this.deriveVerb(method, verbSegment);
    return {
      action: `${resourceType}.${verb}`,
      resourceType,
      resourceId,
    };
  }

  private deriveVerb(method: string, verbSegment?: string): string {
    if (verbSegment) return verbSegment.replace(/-/g, '_');
    if (method === 'POST') return 'create';
    if (method === 'PATCH' || method === 'PUT') return 'update';
    if (method === 'DELETE') return 'delete';
    return method.toLowerCase();
  }

  private sanitize(value: any): any {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((v) => this.sanitize(v));
    if (typeof value !== 'object') return value;

    const out: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_FIELDS.has(key)) {
        out[key] = '[REDACTED]';
      } else if (typeof val === 'object') {
        out[key] = this.sanitize(val);
      } else {
        out[key] = val;
      }
    }
    return out;
  }

  private summarizeResponse(response: any): Record<string, any> | undefined {
    if (response === null || typeof response !== 'object') return undefined;
    const summary: Record<string, any> = {};
    if (response._id) summary._id = String(response._id);
    if (response.id) summary.id = String(response.id);
    if (typeof response.modifiedCount === 'number') summary.modifiedCount = response.modifiedCount;
    if (typeof response.matchedCount === 'number') summary.matchedCount = response.matchedCount;
    if (typeof response.ok === 'boolean') summary.ok = response.ok;
    return Object.keys(summary).length ? summary : undefined;
  }

  private extractResourceLabel(response: any): string | undefined {
    if (response === null || typeof response !== 'object') return undefined;
    return response.name || response.title || response.orderNumber || response.email || undefined;
  }

  private extractIp(req: any): string | undefined {
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
    return req.ip || req.connection?.remoteAddress || undefined;
  }
}

function singularize(plural: string): string {
  // Petite normalisation: "categories" → "category", "users" → "user", "menu-items" → "menu_item"
  const snake = plural.replace(/-/g, '_').toLowerCase();
  if (snake.endsWith('ies')) return snake.slice(0, -3) + 'y';
  if (snake.endsWith('s') && !snake.endsWith('ss')) return snake.slice(0, -1);
  return snake;
}

function isLikelyObjectId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value);
}
