import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

/**
 * Pont entre le ChatService / TablesService (REST) et le gateway socket.io.
 *
 * Évite une dépendance circulaire service ⇄ gateway : le service injecte ce
 * wrapper, et le gateway lui fournit l'instance `Server` dans `afterInit()`.
 * Si le gateway n'est pas attaché (ex. tests unitaires du service), les
 * émissions sont silencieusement ignorées.
 *
 * Contrat d'événements FIGÉ (le frontend est écrit en parallèle) :
 * - 'message:new'    { message } — room 'table:<tableId>' pour un message de
 *   groupe ; rooms 'table:<tableId>:avatar:<fromAvatarId>' ET
 *   'table:<tableId>:avatar:<toAvatarId>' pour un message PRIVÉ (jamais
 *   diffusé à la room de la table entière : les privés d'autrui ne fuient pas).
 * - 'avatar:joined'  { avatar }
 * - 'avatar:left'    { avatarId }
 * - 'avatar:updated' { avatar }
 * - 'table:removed'  { tableId } — émis à la room 'table:<tableId>' lors du
 *   DELETE /tables/:id ; les clients yChat se déconnectent + redirigent.
 * - 'table:deactivated' { tableId } — émis à la room 'table:<tableId>' lors du
 *   PATCH /tables/:id { isActive: false } ; les clients yChat se déconnectent
 *   + redirigent (même comportement que table:removed).
 */
@Injectable()
export class ChatRealtimeService {
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  room(tableId: string): string {
    return `table:${tableId}`;
  }

  /** Room dédiée à un avatar : les sockets la rejoignent au join (avatarId validé). */
  avatarRoom(tableId: string, avatarId: string): string {
    return `table:${tableId}:avatar:${avatarId}`;
  }

  /**
   * `message:new` : room de la table pour un message de groupe
   * (toAvatarId null) ; rooms des deux avatars concernés pour un message
   * privé — un tiers dans la room de la table ne le reçoit jamais.
   */
  emitMessageNew(tableId: string, message: any): void {
    const toAvatarId = message?.toAvatarId ? String(message.toAvatarId) : null;
    if (toAvatarId) {
      const fromAvatarId = message?.fromAvatarId ? String(message.fromAvatarId) : '';
      if (fromAvatarId) {
        this.server?.to(this.avatarRoom(tableId, fromAvatarId)).emit('message:new', { message });
      }
      this.server?.to(this.avatarRoom(tableId, toAvatarId)).emit('message:new', { message });
      return;
    }
    this.server?.to(this.room(tableId)).emit('message:new', { message });
  }

  /**
   * Message privé cross-table : l'expéditeur et le destinataire peuvent être
   * à des tables différentes (même restaurant). On émet dans la room
   * d'avatar de l'expéditeur (sa table) ET dans la room d'avatar du
   * destinataire (sa table).
   */
  emitPrivateMessage(fromTableId: string, message: any, toTableId: string): void {
    const fromAvatarId = message?.fromAvatarId ? String(message.fromAvatarId) : '';
    const toAvatarId = message?.toAvatarId ? String(message.toAvatarId) : '';
    if (fromAvatarId) {
      this.server?.to(this.avatarRoom(fromTableId, fromAvatarId)).emit('message:new', { message });
    }
    if (toAvatarId) {
      this.server?.to(this.avatarRoom(toTableId, toAvatarId)).emit('message:new', { message });
    }
  }

  emitAvatarJoined(tableId: string, avatar: unknown): void {
    this.server?.to(this.room(tableId)).emit('avatar:joined', { avatar });
  }

  emitAvatarLeft(tableId: string, avatarId: string): void {
    this.server?.to(this.room(tableId)).emit('avatar:left', { avatarId });
  }

  emitAvatarUpdated(tableId: string, avatar: unknown): void {
    this.server?.to(this.room(tableId)).emit('avatar:updated', { avatar });
  }

  emitTableRemoved(tableId: string): void {
    this.server?.to(this.room(tableId)).emit('table:removed', { tableId });
  }

  /**
   * `table:deactivated` : table désactivée (PATCH isActive: false) — les
   * clients yChat encore connectés sur la table se déconnectent/redirigent,
   * comme pour table:removed.
   */
  emitTableDeactivated(tableId: string): void {
    this.server?.to(this.room(tableId)).emit('table:deactivated', { tableId });
  }
}
