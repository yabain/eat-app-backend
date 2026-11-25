import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Types } from 'mongoose';
import { Server, Socket } from 'socket.io';
import { buildCorsOrigins, CORS_METHODS } from '../../common/utils/cors.util';
import { ChatService } from './chat.service';
import { ChatRealtimeService } from './chat-realtime.service';

/**
 * Gateway socket.io du yChat.
 *
 * Contrat FIGÉ (le frontend est écrit en parallèle avec ces noms exacts) :
 * - Handshake : POST /socket.io (engine.io), CORS = origines de cors.util.
 * - Handshake JWT optionnel : le token peut être passé dans `auth.token`
 *   (ou header/query `token`/`Authorization`). Sans token la connexion est
 *   acceptée — le produit exige une session côté frontend, mais le backend
 *   ne la bloque pas ; le token sert uniquement à tracer `userId`.
 * - Client → serveur : 'join' { tableId, avatarId? }.
 * - Serveur → client : 'message:new' { message }, 'avatar:joined' { avatar },
 *   'avatar:left' { avatarId }, 'avatar:updated' { avatar },
 *   'table:removed' { tableId }.
 * - Rooms : 'table:<tableId>' (messages de groupe — chat partagé PAR TABLE,
 *   avatars) et 'table:<tableId>:avatar:<avatarId>' (messages privés de cet
 *   avatar).
 *
 * Join avec avatarId : l'avatar est VALIDÉ (existe, appartient à la table,
 * propriété = userId du token — OBLIGATOIRE : un socket sans token ne peut
 * pas s'associer à un avatar) avant toute association au socket.
 * `avatar:left` n'est émis au disconnect que pour un avatar validé — un
 * avatarId refusé au join n'est jamais mémorisé sur le socket (anti-spoof).
 */
@WebSocketGateway({
  path: '/socket.io',
  cors: {
    origin: [...buildCorsOrigins()],
    methods: CORS_METHODS,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.setServer(server);
  }

  /**
   * Handshake JWT optionnel : on tente de décoder le token pour tracer
   * `userId`. Tout échec (token absent, invalide, expiré) laisse la
   * connexion s'établir sans identité.
   */
  handleConnection(client: Socket): void {
    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
      client.handshake.query?.token;
    if (!token || typeof token !== 'string') return;

    try {
      const payload = this.jwtService.verify(token);
      client.data.userId = payload?.sub || null;
    } catch {
      this.logger.debug(`socket ${client.id}: token JWT invalide, connexion acceptée sans identité`);
    }
  }

  handleDisconnect(client: Socket): void {
    // L'avatar n'est PAS supprimé au disconnect (TTL 12h / persistant) :
    // l'événement sert au frontend pour retirer l'utilisateur de la liste
    // des connectés en temps réel.
    // `client.data.avatarId` n'est posé QUE par un join validé (avatar existant,
    // de la table, propriété du token) : un avatarId refusé au join n'est
    // jamais émis ici (anti-spoof, m1).
    const tableId = client.data.tableId;
    const avatarId = client.data.avatarId;
    if (tableId && avatarId) {
      this.realtime.emitAvatarLeft(String(tableId), String(avatarId));
    }
  }

  /**
   * Client → 'join' { tableId, avatarId? } : valide que la table existe et
   * est active puis fait rejoindre la room 'table:<tableId>'. Avec
   * `avatarId`, l'avatar est validé (existe, appartient à la table,
   * propriété du token) et le socket rejoint en plus la room avatar
   * 'table:<id>:avatar:<id>' (diffusion ciblée des messages privés, M1).
   * Le résultat est renvoyé par ack si le client en fournit un, sinon via
   * l'événement 'join:error' en cas d'échec.
   */
  @SubscribeMessage('join')
  handleJoin(client: Socket, payload: { tableId?: string; avatarId?: string }, acknowledge?: (result: unknown) => void) {
    const tableId = String(payload?.tableId || '');
    const finish = (result: unknown) => {
      if (typeof acknowledge === 'function') acknowledge(result);
    };

    if (!Types.ObjectId.isValid(tableId)) {
      const error = { ok: false, error: 'tableId invalide' };
      client.emit('join:error', { tableId });
      finish(error);
      return error;
    }

    return this.chatService
      .findTableById(tableId)
      .then(async (table) => {
        if (!table) {
          const error = { ok: false, error: 'Table introuvable' };
          client.emit('join:error', { tableId });
          finish(error);
          return error;
        }
        if (!table.isActive) {
          const error = { ok: false, error: 'Table désactivée' };
          client.emit('join:error', { tableId });
          finish(error);
          return error;
        }

        const avatarId = payload?.avatarId ? String(payload.avatarId) : null;
        if (avatarId) {
          const invalid = await this.validateAvatarAssociation(client, tableId, avatarId);
          if (invalid) {
            client.emit('join:error', { tableId });
            finish(invalid);
            return invalid;
          }
        }

        client.data.tableId = tableId;
        if (avatarId) {
          // Pose SEULEMENT après validation : disconnect n'émettra avatar:left
          // que pour cet avatar validé.
          client.data.avatarId = avatarId;
          client.join(this.realtime.room(tableId));
          client.join(this.realtime.avatarRoom(tableId, avatarId));
        } else {
          client.join(this.realtime.room(tableId));
        }

        const result = { ok: true, tableId };
        finish(result);
        return result;
      })
      .catch((err) => {
        this.logger.warn(`join(${tableId}) failed: ${err?.message || err}`);
        const error = { ok: false, error: 'Erreur interne' };
        finish(error);
        return error;
      });
  }

  /**
   * m1 — anti-spoof : l'avatarId annoncé par le socket doit exister, appartenir
   * à la table, et (si le token a fourni un userId) appartenir à cet
   * utilisateur. Retourne l'erreur d'ack si refusé, null sinon.
   */
  private async validateAvatarAssociation(
    client: Socket,
    tableId: string,
    avatarId: string,
  ): Promise<{ ok: false; error: string } | null> {
    if (!Types.ObjectId.isValid(avatarId)) {
      return { ok: false, error: 'avatarId invalide' };
    }
    const avatar = await this.chatService.findAvatarById(avatarId);
    if (!avatar) {
      return { ok: false, error: 'Avatar introuvable' };
    }
    if (String(avatar.tableId) !== tableId) {
      return { ok: false, error: 'Avatar hors de cette table' };
    }
    // Anti-spoof STRICT : l'association socket ⇄ avatar exige une identité
    // prouvée par le token. Un socket sans token (userId absent) ne peut pas
    // prouver la propriété → refusé. Sans cette exigence, un socket anonyme
    // pourrait rejoindre l'avatar de N'IMPORTE QUEL client de la table
    // (avatarIds publics via avatar:joined) et recevoir ses messages PRIVÉS
    // (room avatar) + émettre un avatar:left fantôme à sa déconnexion.
    // Tous les avatars sont créés via POST /chat/avatars (guard JWT) et
    // portent donc toujours un userId — le flux légitime n'est pas impacté.
    const userId = client.data.userId;
    if (!userId || !avatar.userId || String(avatar.userId) !== String(userId)) {
      return { ok: false, error: 'Cet avatar ne vous appartient pas' };
    }
    return null;
  }
}
