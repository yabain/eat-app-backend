import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import * as qrcode from 'qrcode';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { UserRole } from '../../common/enums/roles.enum';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ChatMessage, ChatMessageDocument } from '../../database/schemas/chat-message.schema';
import { ChatUser, ChatUserDocument } from '../../database/schemas/chat-user.schema';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
import { Table, TableDocument } from '../../database/schemas/table.schema';
import { TablePosition, TablePositionDocument } from '../../database/schemas/table-position.schema';
import { ChatRealtimeService } from '../chat/chat-realtime.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { CreateTablePositionDto } from './dto/create-table-position.dto';
import { UpdateTablePositionDto } from './dto/update-table-position.dto';

const QR_COLLISION_RETRIES = 3;

/**
 * Gestion des tables et de leurs positions (sièges) — hiérarchie à deux
 * niveaux : Table → positions, chacune avec son QR unique. Le chat de groupe
 * yChat est partagé PAR TABLE.
 *
 * Scoping (identique au reste du projet) : ADMIN voit tout ; MANAGER/EMPLOYEE
 * forcés à `actor.restaurantId` (403 à la création si manager sans restaurant,
 * 404 sinon — ne pas révéler l'existence d'une ressource hors scope).
 */
@Injectable()
export class TablesService {
  private readonly logger = new Logger(TablesService.name);

  constructor(
    @InjectModel(Table.name) private readonly tableModel: Model<TableDocument>,
    @InjectModel(TablePosition.name) private readonly positionModel: Model<TablePositionDocument>,
    @InjectModel(ChatUser.name) private readonly avatarModel: Model<ChatUserDocument>,
    @InjectModel(ChatMessage.name) private readonly messageModel: Model<ChatMessageDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
    private readonly realtime: ChatRealtimeService,
    private readonly auditLogs: AuditLogsService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------------
  // Tables
  // ------------------------------------------------------------------

  async createTable(actor: JwtPayload, dto: CreateTableDto) {
    let restaurantId: string;
    if (actor.role === UserRole.MANAGER) {
      // Manager forcé à son propre restaurant.
      if (!actor.restaurantId) throw new ForbiddenException('Compte manager sans restaurant');
      restaurantId = actor.restaurantId;
    } else {
      restaurantId = dto.restaurantId as string;
      if (!restaurantId) throw new BadRequestException('restaurantId requis');
      // Validation d'existence : évite les tables orphelines pointant vers un
      // restaurant supprimé/inexistant.
      const restaurant = await this.restaurantModel.findById(restaurantId);
      if (!restaurant) throw new NotFoundException('Restaurant introuvable');
    }

    return this.tableModel.create({
      restaurantId: new Types.ObjectId(restaurantId),
      label: this.trimLabel(dto.label),
      isActive: true,
    });
  }

  async listTables(actor: JwtPayload, restaurantId?: string, page?: number, limit?: number) {
    if (restaurantId && !Types.ObjectId.isValid(restaurantId)) {
      throw new BadRequestException('restaurantId invalide');
    }
    const pagination = normalizePagination(page, limit);
    const filter: any = {};

    if (actor.role === UserRole.ADMIN) {
      if (restaurantId) filter.restaurantId = new Types.ObjectId(restaurantId);
    } else {
      // Manager/employee : scoping forcé à leur restaurant.
      if (!actor.restaurantId) {
        return { data: [], meta: buildPaginationMeta(pagination.page, pagination.limit, 0) };
      }
      filter.restaurantId = new Types.ObjectId(actor.restaurantId);
    }

    const [data, total] = await Promise.all([
      this.tableModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
      this.tableModel.countDocuments(filter),
    ]);

    // positionCount par table : agrégat groupé (UNE requête, pas de N+1 côté
    // frontend — décision produit du plan « Tables > positions »).
    const tableIds = data.map((table: any) => table._id);
    const counts = tableIds.length
      ? await this.positionModel.aggregate([
          { $match: { tableId: { $in: tableIds } } },
          { $group: { _id: '$tableId', count: { $sum: 1 } } },
        ])
      : [];
    const countByTable = new Map<string, number>(counts.map((c: any) => [String(c._id), c.count]));

    const dataWithCount = data.map((table: any) => {
      const plain = typeof table?.toJSON === 'function' ? table.toJSON() : table;
      return { ...plain, positionCount: countByTable.get(String(table._id)) || 0 };
    });
    return { data: dataWithCount, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
  }

  async updateTable(actor: JwtPayload, id: string, dto: UpdateTableDto) {
    this.assertValidObjectId(id, 'id');
    const table = await this.tableModel.findById(id);
    if (!table) throw new NotFoundException('Table introuvable');
    this.assertRestaurantScope(actor, table.restaurantId);

    if (dto.label !== undefined) table.label = this.trimLabel(dto.label);
    if (dto.isActive !== undefined) table.isActive = dto.isActive;
    await table.save();

    // Désactivation : les clients yChat connectés sur la table doivent être
    // prévenus (déconnexion + redirection) — émis APRÈS la mise à jour DB,
    // même pattern que table:removed dans deleteTable. Pas d'émission à la
    // réactivation (les clients yChat se reconnectent d'eux-mêmes au scan).
    if (dto.isActive === false) this.realtime.emitTableDeactivated(String(table._id));

    return table;
  }

  /**
   * Suppression d'une table — CASCADE (ordre §7 du plan) :
   * 1. avatars de la table (toutes positions, y compris persistants) ;
   * 2. messages de la table (groupe + privés) ;
   * 3. positions de la table ;
   * 4. la table ;
   * 5. émission `table:removed` à la room `table:<id>` APRÈS la suppression
   *    DB (les clients yChat se déconnectent/redirigent d'eux-mêmes — pas
   *    d'`avatar:left` par avatar : la room est vidée par l'event unique) ;
   * 6. audit log (action destructive).
   */
  async deleteTable(actor: JwtPayload, id: string) {
    this.assertValidObjectId(id, 'id');
    const table = await this.tableModel.findById(id);
    if (!table) throw new NotFoundException('Table introuvable');
    this.assertRestaurantScope(actor, table.restaurantId);

    const tableId = String(table._id);
    const [avatars, messages, positions] = await Promise.all([
      this.avatarModel.deleteMany({ tableId: table._id }),
      this.messageModel.deleteMany({ tableId: table._id }),
      this.positionModel.deleteMany({ tableId: table._id }),
    ]);
    await this.tableModel.deleteOne({ _id: table._id });

    this.realtime.emitTableRemoved(tableId);

    await this.auditLogs.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'table.deleted',
      resourceType: 'Table',
      resourceId: tableId,
      resourceLabel: table.label,
      metadata: {
        restaurantId: String(table.restaurantId),
        positionsDeleted: positions.deletedCount || 0,
        avatarsDeleted: avatars.deletedCount || 0,
        messagesDeleted: messages.deletedCount || 0,
      },
    });
    return { deleted: true };
  }

  // ------------------------------------------------------------------
  // Positions (sièges) d'une table
  // ------------------------------------------------------------------

  async createPosition(actor: JwtPayload, tableId: string, dto: CreateTablePositionDto) {
    this.assertValidObjectId(tableId, 'tableId');
    const table = await this.tableModel.findById(tableId);
    if (!table) throw new NotFoundException('Table introuvable');
    this.assertRestaurantScope(actor, table.restaurantId);

    // Label auto « Siège N » si vide (doublons acceptés — décision D2).
    let label = dto.label?.trim();
    if (!label) {
      const count = await this.positionModel.countDocuments({ tableId: table._id });
      label = `Siège ${count + 1}`;
    }

    // Retry en cas de collision d'idQr (index unique 11000). Épuisement des
    // retries → 409 Conflict propre (jamais le 500 brut du dernier 11000).
    for (let attempt = 0; attempt < QR_COLLISION_RETRIES; attempt++) {
      try {
        return await this.positionModel.create({
          restaurantId: table.restaurantId,
          tableId: table._id,
          idQr: this.generateIdQr(),
          label,
          isActive: true,
        });
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
        if (attempt === QR_COLLISION_RETRIES - 1) {
          throw new ConflictException('Impossible de générer un idQr unique, réessayez');
        }
      }
    }
  }

  async listPositions(actor: JwtPayload, tableId: string, page?: number, limit?: number) {
    this.assertValidObjectId(tableId, 'tableId');
    const table = await this.tableModel.findById(tableId);
    if (!table) throw new NotFoundException('Table introuvable');
    this.assertRestaurantScope(actor, table.restaurantId);

    const pagination = normalizePagination(page, limit);
    const filter = { tableId: table._id };
    const [data, total] = await Promise.all([
      this.positionModel.find(filter).sort({ createdAt: 1 }).skip(pagination.skip).limit(pagination.limit),
      this.positionModel.countDocuments(filter),
    ]);
    return { data, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
  }

  async updatePosition(actor: JwtPayload, tableId: string, id: string, dto: UpdateTablePositionDto) {
    this.assertValidObjectId(tableId, 'tableId');
    this.assertValidObjectId(id, 'id');
    const table = await this.tableModel.findById(tableId);
    if (!table) throw new NotFoundException('Table introuvable');
    this.assertRestaurantScope(actor, table.restaurantId);

    const position = await this.positionModel.findById(id);
    if (!position || String(position.tableId) !== String(table._id)) {
      throw new NotFoundException('Position introuvable');
    }

    if (dto.label !== undefined) position.label = this.trimLabel(dto.label);
    if (dto.isActive !== undefined) position.isActive = dto.isActive;
    await position.save();
    return position;
  }

  /**
   * Suppression d'une position (siège) — CASCADE (ordre §7 du plan) :
   * 1. avatars de la position (y compris persistants) ;
   * 2. leurs messages (fromAvatarId OU toAvatarId ∈ avatars) ;
   * 3. la position ;
   * 4. émission `avatar:left` pour chaque avatar supprimé, APRÈS la
   *    suppression DB — les autres positions de la table continuent le chat
   *    de groupe (les messages de groupe de la table restent) ;
   * 5. audit log (action destructive).
   */
  async deletePosition(actor: JwtPayload, tableId: string, id: string) {
    this.assertValidObjectId(tableId, 'tableId');
    this.assertValidObjectId(id, 'id');
    const table = await this.tableModel.findById(tableId);
    if (!table) throw new NotFoundException('Table introuvable');
    this.assertRestaurantScope(actor, table.restaurantId);

    const position = await this.positionModel.findById(id);
    if (!position || String(position.tableId) !== String(table._id)) {
      throw new NotFoundException('Position introuvable');
    }

    const avatars = await this.avatarModel.find({ positionId: position._id }).select('_id').lean();
    const avatarIds = avatars.map((avatar: any) => avatar._id);
    let messagesDeleted = 0;
    if (avatarIds.length) {
      const messages = await this.messageModel.deleteMany({
        $or: [{ fromAvatarId: { $in: avatarIds } }, { toAvatarId: { $in: avatarIds } }],
      });
      messagesDeleted = messages.deletedCount || 0;
    }
    await this.avatarModel.deleteMany({ positionId: position._id });
    await this.positionModel.deleteOne({ _id: position._id });

    for (const avatarId of avatarIds) {
      this.realtime.emitAvatarLeft(String(table._id), String(avatarId));
    }

    await this.auditLogs.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'table_position.deleted',
      resourceType: 'TablePosition',
      resourceId: String(position._id),
      resourceLabel: position.label || undefined,
      metadata: {
        tableId: String(table._id),
        restaurantId: String(table.restaurantId),
        avatarsDeleted: avatarIds.length,
        messagesDeleted,
      },
    });
    return { deleted: true, avatarsDeleted: avatarIds.length, messagesDeleted };
  }

  async positionQr(actor: JwtPayload, tableId: string, id: string) {
    this.assertValidObjectId(tableId, 'tableId');
    this.assertValidObjectId(id, 'id');
    const table = await this.tableModel.findById(tableId);
    if (!table) throw new NotFoundException('Table introuvable');
    this.assertRestaurantScope(actor, table.restaurantId);

    const position = await this.positionModel.findById(id);
    if (!position || String(position.tableId) !== String(table._id)) {
      throw new NotFoundException('Position introuvable');
    }

    const url = `${this.frontendUrl()}/restaurant/yChat?idQr=${position.idQr}`;
    const dataUrl = await qrcode.toDataURL(url);
    return { dataUrl, url };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Scoping restaurant : hors scope → 404 (jamais 403) — ne pas révéler
   * l'existence d'une ressource d'un autre restaurant.
   */
  private assertRestaurantScope(actor: JwtPayload, restaurantId: Types.ObjectId): void {
    if (actor.role !== UserRole.ADMIN && String(restaurantId) !== actor.restaurantId) {
      throw new NotFoundException('Table introuvable');
    }
  }

  /**
   * Garde-fou id Mongo : id invalide → 400 (BadRequestException) au lieu du
   * CastError 500 du driver — aligne tables.service sur chat.service.
   */
  private assertValidObjectId(id: string, label: string): void {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`${label} invalide`);
  }

  /**
   * Trim du label côté service : vide après trim → 400 (createPosition
   * auto-génère « Siège N » à la place — décision D2).
   */
  private trimLabel(label: string): string {
    const trimmed = label?.trim();
    if (!trimmed) throw new BadRequestException('Label requis');
    return trimmed;
  }

  /** 12 chars base64url (9 octets aléatoires). */
  private generateIdQr(): string {
    return randomBytes(9).toString('base64url');
  }

  private frontendUrl(): string {
    const url = String(this.config.get<string>('FRONTEND_URL') || '').trim().replace(/\/+$/, '');
    if (!url) {
      this.logger.warn(
        'FRONTEND_URL non configurée — fallback http://localhost:4200 (QR codes de dev uniquement)',
      );
      return 'http://localhost:4200';
    }
    return url;
  }
}
