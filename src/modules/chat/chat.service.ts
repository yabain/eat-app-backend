import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { CronLeaseService } from '../../common/cron-lease/cron-lease.service';
import { UserRole } from '../../common/enums/roles.enum';
import { ChatMessage, ChatMessageDocument } from '../../database/schemas/chat-message.schema';
import { CHAT_MESSAGE_TTL_HOURS } from '../../database/schemas/chat-message.schema';
import { CHAT_AVATAR_TTL_HOURS, ChatUser, ChatUserDocument } from '../../database/schemas/chat-user.schema';
import { Table, TableDocument } from '../../database/schemas/table.schema';
import { TablePosition, TablePositionDocument } from '../../database/schemas/table-position.schema';
import { CreateChatAvatarDto } from './dto/create-chat-avatar.dto';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { ChatRealtimeService } from './chat-realtime.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Table.name) private readonly tableModel: Model<TableDocument>,
    @InjectModel(TablePosition.name) private readonly positionModel: Model<TablePositionDocument>,
    @InjectModel(ChatUser.name) private readonly avatarModel: Model<ChatUserDocument>,
    @InjectModel(ChatMessage.name) private readonly messageModel: Model<ChatMessageDocument>,
    private readonly realtime: ChatRealtimeService,
    private readonly cronLease: CronLeaseService,
  ) {}

  // ------------------------------------------------------------------
  // Résolution QR (surface publique du scan yChat)
  // ------------------------------------------------------------------

  /**
   * Résolution d'un QR scanné : session obligatoire (guard JwtAuthGuard côté
   * controller) mais aucun rôle requis. Position inactive → 404 (QR révoqué).
   * Le siège résolu porte sa table (`tableId`) : le yChat rejoint la room de
   * LA TABLE (chat de groupe partagé par table).
   */
  async findPositionByQr(idQr: string) {
    const position = await this.positionModel.findOne({ idQr, isActive: true });
    if (!position) throw new NotFoundException('Position introuvable');
    return {
      position,
      tableId: String(position.tableId),
      restaurantId: String(position.restaurantId),
    };
  }

  async findPositionById(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.positionModel.findById(id);
  }

  /** Table par id — utilisée par le gateway pour valider le join (existe + active). */
  async findTableById(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.tableModel.findById(id);
  }

  // ------------------------------------------------------------------
  // Avatars (ChatUser)
  // ------------------------------------------------------------------

  async createAvatar(actor: JwtPayload, dto: CreateChatAvatarDto) {
    const position = await this.positionModel.findById(dto.positionId);
    if (!position || !position.isActive) throw new NotFoundException('Position introuvable');

    // La table de la position doit être active : un avatar ne peut pas
    // rejoindre le chat d'une table désactivée (le QR de la position reste
    // actif mais la table est fermée) — 404, pas de révélation d'état.
    const table = await this.tableModel.findById(position.tableId);
    if (!table) throw new NotFoundException('Table introuvable');
    if (!table.isActive) throw new NotFoundException('Table désactivée');

    // isPersistant accepté SEULEMENT si userId fourni (l'endpoint est
    // authentifié : userId = actor.sub). Défensif si appelé sans session.
    const isPersistant = !!dto.isPersistant;
    if (isPersistant && !actor?.sub) throw new BadRequestException('isPersistant requiert un utilisateur authentifié');

    const payload: any = {
      restaurantId: position.restaurantId,
      positionId: position._id,
      // Dénormalisé depuis la position : le chat de groupe est partagé PAR
      // TABLE, quel que soit le siège scanné.
      tableId: position.tableId,
      pseudo: dto.pseudo,
      sex: dto.sex,
      photoUrl: dto.photoUrl,
      status: 'online',
      isVerified: false,
      isPersistant,
      userId: actor?.sub ? new Types.ObjectId(actor.sub) : null,
      socialUrls: dto.socialUrls || {},
    };
    // TTL : expiresAt posé UNIQUEMENT si non persistant. Champ ABSENT sinon
    // (condition de non-expiration de l'index TTL).
    if (!isPersistant) payload.expiresAt = new Date(Date.now() + CHAT_AVATAR_TTL_HOURS * 3600 * 1000);

    const avatar = await this.avatarModel.create(payload);
    // Projection publique : jamais userId ni expiresAt vers les clients.
    this.realtime.emitAvatarJoined(String(position.tableId), this.projectAvatar(avatar));
    return this.projectAvatar(avatar);
  }

  /**
   * Avatars non expirés d'une TABLE (toutes positions confondues — la barre
   * « Ma table » liste les avatars de la table entière). Validation légère
   * que la table existe (404) — pas de scoping par rôle (endpoint session
   * yChat). Filtre TTL/persistant inchangé.
   */
  async listAvatars(actor: JwtPayload, tableId: string) {
    if (!Types.ObjectId.isValid(tableId)) throw new BadRequestException('tableId invalide');
    const table = await this.tableModel.findById(tableId);
    if (!table) throw new NotFoundException('Table introuvable');
    const now = new Date();
    const avatars = await this.avatarModel
      .find({
        tableId: table._id,
        $or: [{ isPersistant: true }, { expiresAt: { $gt: now } }],
      })
      .sort({ createdAt: -1 });
    return avatars.map((avatar) => this.projectAvatar(avatar));
  }

  /**
   * Avatar par id — utilisé par le gateway pour valider l'association
   * socket ⇄ avatar au join (existence, appartenance à la table,
   * propriété par l'utilisateur du token). Jamais exposé tel quel : la
   * projection publique est appliquée par l'appelant.
   */
  async findAvatarById(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.avatarModel.findById(id);
  }

  async deleteAvatar(actor: JwtPayload, id: string) {
    const avatar = await this.avatarModel.findById(id);
    if (!avatar) throw new NotFoundException('Avatar introuvable');

    const isOwner = avatar.userId && String(avatar.userId) === actor.sub;
    if (!isOwner && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Seul le propriétaire de l\'avatar peut le supprimer');
    }

    const tableId = String(avatar.tableId);
    // Cascade immédiate : messages émis et reçus par l'avatar.
    const messages = await this.messageModel.deleteMany({
      $or: [{ fromAvatarId: avatar._id }, { toAvatarId: avatar._id }],
    });
    await this.avatarModel.deleteOne({ _id: avatar._id });
    this.realtime.emitAvatarLeft(tableId, String(avatar._id));
    return { deleted: true, messagesDeleted: messages.deletedCount || 0 };
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------

  async createMessage(actor: JwtPayload, dto: CreateChatMessageDto) {
    const fromAvatar = await this.avatarModel.findById(dto.fromAvatarId);
    if (!fromAvatar) throw new NotFoundException('Avatar émetteur introuvable');
    // L'avatar émetteur doit appartenir à l'actor (un avatar créé par un
    // utilisateur authentifié porte son userId).
    if (!fromAvatar.userId || String(fromAvatar.userId) !== actor.sub) {
      throw new ForbiddenException('Cet avatar ne vous appartient pas');
    }
    // Cohérence tableId : le frontend envoie la table affichée ; on refuse
    // toute divergence avec la table réelle de l'avatar émetteur.
    if (String(dto.tableId) !== String(fromAvatar.tableId)) {
      throw new BadRequestException('tableId incohérent avec l\'avatar émetteur');
    }

    let toAvatarId: Types.ObjectId | null = null;
    if (dto.toAvatarId) {
      const toAvatar = await this.avatarModel.findById(dto.toAvatarId);
      if (!toAvatar) throw new NotFoundException('Avatar destinataire introuvable');
      if (String(toAvatar.tableId) !== String(fromAvatar.tableId)) {
        throw new BadRequestException('L\'avatar destinataire n\'appartient pas à la même table');
      }
      toAvatarId = toAvatar._id;
    }

    const tableId = String(fromAvatar.tableId);
    const message = await this.messageModel.create({
      restaurantId: fromAvatar.restaurantId,
      tableId: fromAvatar.tableId,
      fromAvatarId: fromAvatar._id,
      toAvatarId,
      content: dto.content,
      expiresAt: new Date(Date.now() + CHAT_MESSAGE_TTL_HOURS * 3600 * 1000),
    });
    this.realtime.emitMessageNew(tableId, message);
    return message;
  }

  /**
   * Liste des messages d'une TABLE (toutes positions confondues), filtrée par
   * la perspective de l'actor :
   * - message de groupe (toAvatarId null) : visible par tous ;
   * - message privé : visible SEULEMENT par les avatars concernés
   *   (fromAvatarId ou toAvatarId = avatar de l'actor).
   * Perspective = avatar de l'actor sur la table : `avatarId` validé
   * (appartient à l'actor) sinon l'avatar le plus récent de l'actor sur la
   * table. Sans avatar sur la table → messages de groupe uniquement.
   */
  async listMessages(actor: JwtPayload, tableId: string, page?: number, limit?: number, avatarId?: string) {
    if (!Types.ObjectId.isValid(tableId)) throw new BadRequestException('tableId invalide');
    const pagination = normalizePagination(page, limit);

    let actorAvatarId: Types.ObjectId | null = null;
    if (avatarId) {
      if (!Types.ObjectId.isValid(avatarId)) throw new BadRequestException('avatarId invalide');
      const avatar = await this.avatarModel.findById(avatarId);
      if (!avatar) throw new NotFoundException('Avatar introuvable');
      if (String(avatar.tableId) !== tableId) {
        throw new BadRequestException('Avatar hors de cette table');
      }
      if (!avatar.userId || String(avatar.userId) !== actor.sub) {
        throw new ForbiddenException('Cet avatar ne vous appartient pas');
      }
      actorAvatarId = avatar._id;
    } else {
      // Perspective par défaut : l'avatar le plus récent de l'actor sur la
      // table (un utilisateur peut avoir plusieurs avatars).
      const avatar = await this.avatarModel
        .findOne({ tableId: new Types.ObjectId(tableId), userId: new Types.ObjectId(actor.sub) })
        .sort({ createdAt: -1 });
      actorAvatarId = avatar?._id ?? null;
    }

    const filter: any = {
      tableId: new Types.ObjectId(tableId),
      // Double protection avec l'index TTL : les messages expirés ne sont
      // jamais servis même si le TTL Mongo traîne.
      expiresAt: { $gt: new Date() },
      // Visibilité : groupe = public ; privé = uniquement les avatars
      // concernés (jamais les privés d'autrui).
      ...(actorAvatarId
        ? { $or: [{ toAvatarId: null }, { fromAvatarId: actorAvatarId }, { toAvatarId: actorAvatarId }] }
        : { toAvatarId: null }),
    };
    const [data, total] = await Promise.all([
      this.messageModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
      this.messageModel.countDocuments(filter),
    ]);
    return { data, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
  }

  // ------------------------------------------------------------------
  // Cron de purge (cascade TTL + orphelins)
  // ------------------------------------------------------------------

  /**
   * Purge toutes les 10 minutes (Africa/Douala), protégée par lease :
   * - avatars expirés restants (si le TTL Mongo traîne) → cascade sur leurs
   *   messages (émetteur ET destinataire) ;
   * - avatars orphelins (position/siège supprimée — filet de sécurité si la
   *   cascade de TablesService a échoué partiellement ou en course) → leurs
   *   messages + `avatar:left` ;
   * - messages orphelins (fromAvatarId n'existe plus).
   */
  @Cron('*/10 * * * *', { timeZone: 'Africa/Douala' })
  async purgeExpired() {
    if (!(await this.cronLease.acquire('chat.purge', 9 * 60 * 1000))) return;
    try {
      const now = new Date();
      let avatarsDeleted = 0;
      let messagesDeleted = 0;

      // 1. Avatars expirés (TTL 12h) — cascade sur leurs messages.
      const expiredAvatars = await this.avatarModel.find({ expiresAt: { $lte: now } }).select('_id').lean();
      const expiredIds = expiredAvatars.map((avatar: any) => avatar._id);
      if (expiredIds.length) {
        const messages = await this.messageModel.deleteMany({
          $or: [{ fromAvatarId: { $in: expiredIds } }, { toAvatarId: { $in: expiredIds } }],
        });
        const avatars = await this.avatarModel.deleteMany({ _id: { $in: expiredIds } });
        messagesDeleted += messages.deletedCount || 0;
        avatarsDeleted += avatars.deletedCount || 0;
      }

      // 2. Avatars orphelins : leur position (siège) n'existe plus.
      const avatarPositionIds = (await this.avatarModel.distinct('positionId')) as any[];
      const alivePositions = await this.positionModel
        .find({ _id: { $in: avatarPositionIds } })
        .select('_id')
        .lean();
      const alivePositionIds = new Set(alivePositions.map((p: any) => String(p._id)));
      const orphanPositionIds = avatarPositionIds.filter((id: any) => !alivePositionIds.has(String(id)));
      if (orphanPositionIds.length) {
        const orphans = await this.avatarModel
          .find({ positionId: { $in: orphanPositionIds } })
          .select('_id tableId')
          .lean();
        const orphanIds = orphans.map((a: any) => a._id);
        if (orphanIds.length) {
          const messages = await this.messageModel.deleteMany({
            $or: [{ fromAvatarId: { $in: orphanIds } }, { toAvatarId: { $in: orphanIds } }],
          });
          const avatars = await this.avatarModel.deleteMany({ _id: { $in: orphanIds } });
          messagesDeleted += messages.deletedCount || 0;
          avatarsDeleted += avatars.deletedCount || 0;
          // avatar:left pour chaque avatar orphelin — room de sa table.
          for (const orphan of orphans) {
            if (orphan.tableId) this.realtime.emitAvatarLeft(String(orphan.tableId), String(orphan._id));
          }
        }
      }

      // 3. Messages orphelins : fromAvatarId ne référence plus aucun avatar.
      const fromIds = await this.messageModel.distinct('fromAvatarId');
      const alive = await this.avatarModel.find({ _id: { $in: fromIds } }).select('_id').lean();
      const aliveIds = new Set(alive.map((avatar: any) => String(avatar._id)));
      const orphanIds = fromIds.filter((id: any) => !aliveIds.has(String(id)));
      if (orphanIds.length) {
        const orphans = await this.messageModel.deleteMany({ fromAvatarId: { $in: orphanIds } });
        messagesDeleted += orphans.deletedCount || 0;
      }

      if (avatarsDeleted || messagesDeleted) {
        this.logger.log(
          `chat.purge : ${avatarsDeleted} avatars supprimés (expirés/orphelins), ${messagesDeleted} messages nettoyés`,
        );
      }
    } catch (error: any) {
      this.logger.warn(`chat.purge failed: ${error?.message || error}`);
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Projection publique d'un avatar (m2 — userId jamais exposé) : pseudo,
   * sex, photoUrl, status, socialUrls, _id, positionId, tableId, isVerified.
   * PAS userId, PAS expiresAt, PAS restaurantId.
   */
  private projectAvatar(avatar: any) {
    return {
      _id: avatar._id,
      positionId: avatar.positionId,
      tableId: avatar.tableId,
      pseudo: avatar.pseudo,
      sex: avatar.sex,
      photoUrl: avatar.photoUrl,
      status: avatar.status,
      socialUrls: avatar.socialUrls || {},
      isVerified: !!avatar.isVerified,
    };
  }
}
