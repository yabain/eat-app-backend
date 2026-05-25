import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../../database/schemas/audit-log.schema';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex } from '../../common/utils/search.util';

export interface RecordAuditInput {
  actorId?: string | null;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  resourceLabel?: string;
  metadata?: Record<string, any>;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  /**
   * Écriture best-effort : ne lève jamais d'erreur (sinon ça casserait
   * la requête métier qui a déjà réussi). On log un warn en cas d'échec.
   */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.auditLogModel.create({
        actorId: input.actorId || null,
        actorEmail: input.actorEmail,
        actorRole: input.actorRole,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        resourceLabel: input.resourceLabel,
        metadata: input.metadata,
        method: input.method,
        path: input.path,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        ip: input.ip,
        userAgent: input.userAgent,
      });
    } catch (err: any) {
      this.logger.warn(`Failed to persist audit log: ${err?.message || err}`);
    }
  }

  async list(
    page?: number,
    limit?: number,
    filters?: { q?: string; action?: string; resourceType?: string; actorId?: string; from?: string; to?: string },
  ) {
    const pagination = normalizePagination(page, limit);
    const filter: any = {};

    if (filters?.action) filter.action = filters.action;
    if (filters?.resourceType) filter.resourceType = filters.resourceType;
    if (filters?.actorId) filter.actorId = filters.actorId;

    const qRegex = buildContainsRegex(filters?.q);
    if (qRegex) {
      filter.$or = [
        { action: qRegex },
        { actorEmail: qRegex },
        { resourceLabel: qRegex },
        { resourceId: qRegex },
        { path: qRegex },
      ];
    }

    if (filters?.from || filters?.to) {
      const createdAt: any = {};
      if (filters.from) {
        const from = new Date(filters.from);
        if (!Number.isNaN(from.getTime())) createdAt.$gte = from;
      }
      if (filters.to) {
        const to = new Date(filters.to);
        if (!Number.isNaN(to.getTime())) createdAt.$lte = to;
      }
      if (Object.keys(createdAt).length) filter.createdAt = createdAt;
    }

    const [data, total] = await Promise.all([
      this.auditLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.auditLogModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }
}
