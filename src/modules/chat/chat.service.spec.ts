import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/roles.enum';
import { CHAT_MESSAGE_TTL_HOURS } from '../../database/schemas/chat-message.schema';
import { CHAT_AVATAR_TTL_HOURS } from '../../database/schemas/chat-user.schema';
import { ChatService } from './chat.service';
import { ChatRealtimeService } from './chat-realtime.service';

const RESTAURANT_ID = new Types.ObjectId();
const TABLE_ID = new Types.ObjectId();
const OTHER_TABLE_ID = new Types.ObjectId();
const POSITION_ID = new Types.ObjectId();
const AVATAR_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();

const manager = {
  sub: String(USER_ID),
  email: 'manager@resto.cm',
  role: UserRole.MANAGER,
  restaurantId: String(RESTAURANT_ID),
};

const table = { _id: TABLE_ID, restaurantId: RESTAURANT_ID, label: 'Table 3', isActive: true };
const position = {
  _id: POSITION_ID,
  restaurantId: RESTAURANT_ID,
  tableId: TABLE_ID,
  idQr: 'AbCdEfGh1234',
  label: 'Siège 1',
  isActive: true,
};

function makeService(overrides: Record<string, any> = {}) {
  const tableModel: any = {
    // Table active par défaut : le happy path de createAvatar en dépend (m5).
    findById: jest.fn().mockResolvedValue(table),
  };
  const positionModel: any = {
    findById: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    }),
  };
  const avatarModel: any = {
    create: jest.fn().mockImplementation(async (payload: any) => ({ _id: AVATAR_ID, ...payload })),
    findById: jest.fn(),
    findOne: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue(null) }),
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    distinct: jest.fn().mockResolvedValue([]),
  };
  const messageModel: any = {
    create: jest.fn().mockImplementation(async (payload: any) => ({ _id: new Types.ObjectId(), ...payload })),
    find: jest.fn(),
    countDocuments: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 5 }),
    distinct: jest.fn().mockResolvedValue([]),
  };
  const cronLease = { acquire: jest.fn().mockResolvedValue(true) };
  const realtime = new ChatRealtimeService();
  const emitSpies = {
    messageNew: jest.spyOn(realtime, 'emitMessageNew'),
    avatarJoined: jest.spyOn(realtime, 'emitAvatarJoined'),
    avatarLeft: jest.spyOn(realtime, 'emitAvatarLeft'),
    tableRemoved: jest.spyOn(realtime, 'emitTableRemoved'),
  };

  const service = new ChatService(
    overrides.tableModel || tableModel,
    overrides.positionModel || positionModel,
    overrides.avatarModel || avatarModel,
    overrides.messageModel || messageModel,
    realtime,
    overrides.cronLease || cronLease,
  );
  return {
    service,
    tableModel: overrides.tableModel || tableModel,
    positionModel: overrides.positionModel || positionModel,
    avatarModel: overrides.avatarModel || avatarModel,
    messageModel: overrides.messageModel || messageModel,
    cronLease: overrides.cronLease || cronLease,
    realtime,
    emitSpies,
  };
}

describe('ChatService — résolution QR (by-qr)', () => {
  it('by-qr : retourne { position, tableId, restaurantId }', async () => {
    const { service, positionModel } = makeService();
    positionModel.findOne = jest.fn().mockResolvedValue(position);
    const result = await service.findPositionByQr('AbCdEfGh1234');
    expect(positionModel.findOne).toHaveBeenCalledWith({ idQr: 'AbCdEfGh1234', isActive: true });
    expect(result.position).toEqual(position);
    expect(result.tableId).toBe(String(TABLE_ID));
    expect(result.restaurantId).toBe(String(RESTAURANT_ID));
  });

  it('by-qr : position inactive → 404 (QR révoqué)', async () => {
    const { service, positionModel } = makeService();
    positionModel.findOne = jest.fn().mockResolvedValue(null);
    await expect(service.findPositionByQr('AbCdEfGh1234')).rejects.toThrow(NotFoundException);
    expect(positionModel.findOne).toHaveBeenCalledWith({ idQr: 'AbCdEfGh1234', isActive: true });
  });

  it('findTableById : id invalide → null ; id valide → table', async () => {
    const { service, tableModel } = makeService();
    expect(await service.findTableById('not-an-id')).toBeNull();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    expect(await service.findTableById(String(TABLE_ID))).toEqual(table);
  });
});

describe('ChatService — avatars', () => {
  it('createAvatar : tableId dénormalisé depuis la position (positionId + tableId stockés)', async () => {
    const { service, positionModel, avatarModel, emitSpies } = makeService();
    positionModel.findById = jest.fn().mockResolvedValue(position);
    const before = Date.now();
    await service.createAvatar(manager, {
      positionId: String(POSITION_ID),
      pseudo: 'Jean237',
      sex: 'M',
      photoUrl: '/uploads/avatars/a.png',
    });
    const payload = (avatarModel as any).create.mock.calls[0][0];
    expect(payload.tableId).toEqual(TABLE_ID);
    expect(payload.positionId).toEqual(POSITION_ID);
    expect(payload.restaurantId).toEqual(RESTAURANT_ID);
    expect(payload.userId).toEqual(USER_ID);
    expect(payload.status).toBe('online');
    expect(payload.expiresAt).toBeInstanceOf(Date);
    expect(payload.expiresAt.getTime()).toBeGreaterThanOrEqual(before + CHAT_AVATAR_TTL_HOURS * 3600 * 1000 - 1000);
    // Émission sur la room de LA TABLE (chat partagé par table).
    expect(emitSpies.avatarJoined).toHaveBeenCalledWith(String(TABLE_ID), expect.anything());
  });

  it('createAvatar : position inexistante ou inactive → 404', async () => {
    const { service, positionModel, avatarModel } = makeService();
    positionModel.findById = jest.fn().mockResolvedValue(null);
    await expect(
      service.createAvatar(manager, { positionId: String(POSITION_ID), pseudo: 'Jean237', sex: 'M', photoUrl: '/a.png' }),
    ).rejects.toThrow(NotFoundException);
    positionModel.findById = jest.fn().mockResolvedValue({ ...position, isActive: false });
    await expect(
      service.createAvatar(manager, { positionId: String(POSITION_ID), pseudo: 'Jean237', sex: 'M', photoUrl: '/a.png' }),
    ).rejects.toThrow(NotFoundException);
    expect(avatarModel.create).not.toHaveBeenCalled();
  });

  it('createAvatar : position active mais TABLE désactivée → 404 « Table désactivée » (m5)', async () => {
    const { service, positionModel, tableModel, avatarModel, emitSpies } = makeService();
    positionModel.findById = jest.fn().mockResolvedValue(position);
    tableModel.findById = jest.fn().mockResolvedValue({ ...table, isActive: false });
    await expect(
      service.createAvatar(manager, { positionId: String(POSITION_ID), pseudo: 'Jean237', sex: 'M', photoUrl: '/a.png' }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.createAvatar(manager, { positionId: String(POSITION_ID), pseudo: 'Jean237', sex: 'M', photoUrl: '/a.png' }),
    ).rejects.toThrow('Table désactivée');
    expect(avatarModel.create).not.toHaveBeenCalled();
    expect(emitSpies.avatarJoined).not.toHaveBeenCalled();
  });

  it('createAvatar : table de la position introuvable → 404', async () => {
    const { service, positionModel, tableModel, avatarModel } = makeService();
    positionModel.findById = jest.fn().mockResolvedValue(position);
    tableModel.findById = jest.fn().mockResolvedValue(null);
    await expect(
      service.createAvatar(manager, { positionId: String(POSITION_ID), pseudo: 'Jean237', sex: 'M', photoUrl: '/a.png' }),
    ).rejects.toThrow(NotFoundException);
    expect(avatarModel.create).not.toHaveBeenCalled();
  });

  it('createAvatar : isPersistant sans userId : 400', async () => {
    const { service, positionModel, avatarModel } = makeService();
    positionModel.findById = jest.fn().mockResolvedValue(position);
    await expect(
      service.createAvatar(
        { ...manager, sub: undefined as any },
        { positionId: String(POSITION_ID), pseudo: 'Jean237', sex: 'M', photoUrl: '/a.png', isPersistant: true },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(avatarModel.create).not.toHaveBeenCalled();
  });

  it('createAvatar : persistant → champ expiresAt ABSENT (jamais null)', async () => {
    const { service, positionModel, avatarModel } = makeService();
    positionModel.findById = jest.fn().mockResolvedValue(position);
    await service.createAvatar(manager, {
      positionId: String(POSITION_ID),
      pseudo: 'Jean237',
      sex: 'M',
      photoUrl: '/a.png',
      isPersistant: true,
    });
    const payload = (avatarModel as any).create.mock.calls[0][0];
    expect('expiresAt' in payload).toBe(false);
  });

  it('createAvatar : projection publique (pas de userId/expiresAt/restaurantId)', async () => {
    const { service, positionModel } = makeService();
    positionModel.findById = jest.fn().mockResolvedValue(position);
    const avatar = await service.createAvatar(manager, {
      positionId: String(POSITION_ID),
      pseudo: 'Jean237',
      sex: 'M',
      photoUrl: '/a.png',
    });
    expect(avatar).not.toHaveProperty('userId');
    expect(avatar).not.toHaveProperty('expiresAt');
    expect(avatar).not.toHaveProperty('restaurantId');
    expect(avatar).toHaveProperty('positionId', POSITION_ID);
    expect(avatar).toHaveProperty('tableId', TABLE_ID);
  });

  it('listAvatars : tableId invalide → 400 ; table introuvable → 404', async () => {
    const { service, tableModel } = makeService();
    await expect(service.listAvatars(manager, 'abc')).rejects.toThrow(BadRequestException);
    tableModel.findById = jest.fn().mockResolvedValue(null);
    await expect(service.listAvatars(manager, String(TABLE_ID))).rejects.toThrow(NotFoundException);
  });

  it('listAvatars : filtre par tableId + TTL/persistant inchangé', async () => {
    const { service, tableModel, avatarModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    (avatarModel as any).find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      then: (resolve: any) => resolve([]),
    });
    await service.listAvatars(manager, String(TABLE_ID));
    const filter = (avatarModel as any).find.mock.calls[0][0];
    expect(filter.tableId).toEqual(TABLE_ID);
    expect(filter.$or).toEqual([
      { isPersistant: true },
      { expiresAt: { $gt: expect.any(Date) } },
    ]);
  });

  it('listAvatars : projection sans userId ni expiresAt', async () => {
    const { service, tableModel, avatarModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    (avatarModel as any).find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      then: (resolve: any) =>
        resolve([
          {
            _id: AVATAR_ID,
            positionId: POSITION_ID,
            tableId: TABLE_ID,
            pseudo: 'Jean237',
            sex: 'M',
            photoUrl: '/a.png',
            status: 'online',
            socialUrls: { instagram: 'https://instagram.com/j' },
            isVerified: true,
            isPersistant: true,
            userId: USER_ID,
          },
        ]),
    });
    const result = await service.listAvatars(manager, String(TABLE_ID));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      _id: AVATAR_ID,
      positionId: POSITION_ID,
      tableId: TABLE_ID,
      pseudo: 'Jean237',
      sex: 'M',
      photoUrl: '/a.png',
      status: 'online',
      socialUrls: { instagram: 'https://instagram.com/j' },
      isVerified: true,
    });
    expect(result[0]).not.toHaveProperty('userId');
    expect(result[0]).not.toHaveProperty('expiresAt');
  });

  it('deleteAvatar : propriétaire → cascade messages + avatar:left sur room table', async () => {
    const { service, avatarModel, messageModel, emitSpies } = makeService();
    (avatarModel as any).findById = jest.fn().mockResolvedValue({
      _id: AVATAR_ID,
      tableId: TABLE_ID,
      positionId: POSITION_ID,
      userId: USER_ID,
    });
    const result = await service.deleteAvatar(manager, String(AVATAR_ID));
    expect(result.deleted).toBe(true);
    expect(messageModel.deleteMany).toHaveBeenCalledWith({
      $or: [{ fromAvatarId: AVATAR_ID }, { toAvatarId: AVATAR_ID }],
    });
    expect(avatarModel.deleteOne).toHaveBeenCalledWith({ _id: AVATAR_ID });
    expect(emitSpies.avatarLeft).toHaveBeenCalledWith(String(TABLE_ID), String(AVATAR_ID));
  });

  it('deleteAvatar : non propriétaire → 403, admin → autorisé', async () => {
    const { service, avatarModel } = makeService();
    (avatarModel as any).findById = jest.fn().mockResolvedValue({
      _id: AVATAR_ID,
      tableId: TABLE_ID,
      userId: new Types.ObjectId(),
    });
    await expect(service.deleteAvatar(manager, String(AVATAR_ID))).rejects.toThrow(ForbiddenException);
    await expect(service.deleteAvatar({ ...manager, role: UserRole.ADMIN }, String(AVATAR_ID))).resolves.toBeTruthy();
  });
});

describe('ChatService — messages (par table)', () => {
  const fromAvatar = {
    _id: AVATAR_ID,
    restaurantId: RESTAURANT_ID,
    tableId: TABLE_ID,
    positionId: POSITION_ID,
    userId: USER_ID,
  };

  it('fromAvatarId ne vous appartient pas → 403', async () => {
    const { service, avatarModel, messageModel } = makeService();
    (avatarModel as any).findById = jest.fn().mockResolvedValue({ ...fromAvatar, userId: new Types.ObjectId() });
    await expect(
      service.createMessage(manager, { tableId: String(TABLE_ID), fromAvatarId: String(AVATAR_ID), content: 'Salut' }),
    ).rejects.toThrow(ForbiddenException);
    expect(messageModel.create).not.toHaveBeenCalled();
  });

  it('avatar émetteur introuvable → 404', async () => {
    const { service, avatarModel } = makeService();
    (avatarModel as any).findById = jest.fn().mockResolvedValue(null);
    await expect(
      service.createMessage(manager, { tableId: String(TABLE_ID), fromAvatarId: String(AVATAR_ID), content: 'Salut' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('tableId incohérent avec la table de l\'avatar émetteur → 400', async () => {
    const { service, avatarModel, messageModel } = makeService();
    (avatarModel as any).findById = jest.fn().mockResolvedValue(fromAvatar);
    await expect(
      service.createMessage(manager, { tableId: String(OTHER_TABLE_ID), fromAvatarId: String(AVATAR_ID), content: 'Salut' }),
    ).rejects.toThrow(BadRequestException);
    expect(messageModel.create).not.toHaveBeenCalled();
  });

  it('toAvatarId d\'une autre table → 400', async () => {
    const { service, avatarModel } = makeService();
    (avatarModel as any).findById = jest.fn().mockImplementation((id: string) => {
      if (String(id) === String(AVATAR_ID)) return Promise.resolve(fromAvatar);
      return Promise.resolve({ _id: new Types.ObjectId(), tableId: OTHER_TABLE_ID, userId: new Types.ObjectId() });
    });
    await expect(
      service.createMessage(manager, {
        tableId: String(TABLE_ID),
        fromAvatarId: String(AVATAR_ID),
        toAvatarId: String(new Types.ObjectId()),
        content: 'Salut',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('message de groupe : toAvatarId null, tableId stocké, expiresAt = +10h, message:new émis sur room table', async () => {
    const { service, avatarModel, messageModel, emitSpies } = makeService();
    (avatarModel as any).findById = jest.fn().mockResolvedValue(fromAvatar);
    const before = Date.now();
    await service.createMessage(manager, {
      tableId: String(TABLE_ID),
      fromAvatarId: String(AVATAR_ID),
      content: 'On commande quoi ?',
    });
    const payload = (messageModel as any).create.mock.calls[0][0];
    expect(payload.toAvatarId).toBeNull();
    expect(payload.tableId).toEqual(TABLE_ID);
    expect(payload.restaurantId).toEqual(RESTAURANT_ID);
    expect(payload.expiresAt.getTime()).toBeGreaterThanOrEqual(before + CHAT_MESSAGE_TTL_HOURS * 3600 * 1000 - 1000);
    expect(emitSpies.messageNew).toHaveBeenCalledWith(String(TABLE_ID), expect.anything());
  });

  it('message privé : toAvatarId résolu (même table)', async () => {
    const { service, avatarModel, messageModel } = makeService();
    const toAvatar = { _id: new Types.ObjectId(), tableId: TABLE_ID, userId: new Types.ObjectId() };
    (avatarModel as any).findById = jest.fn().mockImplementation((id: string) => {
      if (String(id) === String(AVATAR_ID)) return Promise.resolve(fromAvatar);
      return Promise.resolve(toAvatar);
    });
    await service.createMessage(manager, {
      tableId: String(TABLE_ID),
      fromAvatarId: String(AVATAR_ID),
      toAvatarId: String(toAvatar._id),
      content: 'Salut toi',
    });
    const payload = (messageModel as any).create.mock.calls[0][0];
    expect(payload.toAvatarId).toEqual(toAvatar._id);
  });

  function stubMessageChain() {
    return {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ _id: 'm1' }]),
      }),
      countDocuments: jest.fn().mockResolvedValue(1),
    };
  }

  it('listMessages : actor avec avatar sur la table → privés le concernant inclus via $or', async () => {
    const messageModel = stubMessageChain();
    const { service, avatarModel } = makeService({ messageModel });
    (avatarModel as any).findOne = jest.fn().mockReturnValue({
      sort: jest.fn().mockResolvedValue({ _id: AVATAR_ID, tableId: TABLE_ID, userId: USER_ID }),
    });
    await service.listMessages(manager, String(TABLE_ID), 1, 20);
    const filter = messageModel.find.mock.calls[0][0];
    expect(filter.tableId).toEqual(TABLE_ID);
    expect(filter.$or).toEqual([
      { toAvatarId: null },
      { fromAvatarId: AVATAR_ID },
      { toAvatarId: AVATAR_ID },
    ]);
  });

  it('listMessages : actor sans avatar sur la table → messages de groupe uniquement', async () => {
    const messageModel = stubMessageChain();
    const { service, avatarModel } = makeService({ messageModel });
    (avatarModel as any).findOne = jest.fn().mockReturnValue({
      sort: jest.fn().mockResolvedValue(null),
    });
    await service.listMessages(manager, String(TABLE_ID));
    const filter = messageModel.find.mock.calls[0][0];
    expect(filter.tableId).toEqual(TABLE_ID);
    expect(filter.toAvatarId).toBeNull();
    expect(filter.$or).toBeUndefined();
  });

  it('listMessages : perspective par défaut = avatar le plus récent de l\'actor sur la table', async () => {
    const messageModel = stubMessageChain();
    const { service, avatarModel } = makeService({ messageModel });
    (avatarModel as any).findOne = jest.fn().mockReturnValue({
      sort: jest.fn().mockResolvedValue({ _id: AVATAR_ID, tableId: TABLE_ID, userId: USER_ID }),
    });
    await service.listMessages(manager, String(TABLE_ID));
    expect(avatarModel.findOne).toHaveBeenCalledWith({
      tableId: new Types.ObjectId(String(TABLE_ID)),
      userId: USER_ID,
    });
  });

  it('listMessages : avatarId param owned → perspective choisie explicitement', async () => {
    const messageModel = stubMessageChain();
    const { service, avatarModel } = makeService({ messageModel });
    const otherAvatarId = new Types.ObjectId();
    (avatarModel as any).findById = jest.fn().mockResolvedValue({
      _id: otherAvatarId,
      tableId: TABLE_ID,
      userId: USER_ID,
    });
    await service.listMessages(manager, String(TABLE_ID), 1, 20, String(otherAvatarId));
    const filter = messageModel.find.mock.calls[0][0];
    expect(filter.$or).toEqual([
      { toAvatarId: null },
      { fromAvatarId: otherAvatarId },
      { toAvatarId: otherAvatarId },
    ]);
    expect(avatarModel.findOne).not.toHaveBeenCalled();
  });

  it('listMessages : avatarId param d\'un autre utilisateur → 403', async () => {
    const { service, avatarModel } = makeService();
    const avatarId = new Types.ObjectId();
    (avatarModel as any).findById = jest.fn().mockResolvedValue({
      _id: avatarId,
      tableId: TABLE_ID,
      userId: new Types.ObjectId(),
    });
    await expect(service.listMessages(manager, String(TABLE_ID), 1, 20, String(avatarId))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('listMessages : avatarId param d\'une autre table → 400', async () => {
    const { service, avatarModel } = makeService();
    const avatarId = new Types.ObjectId();
    (avatarModel as any).findById = jest.fn().mockResolvedValue({
      _id: avatarId,
      tableId: OTHER_TABLE_ID,
      userId: USER_ID,
    });
    await expect(service.listMessages(manager, String(TABLE_ID), 1, 20, String(avatarId))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('listMessages : avatarId param introuvable → 404', async () => {
    const { service, avatarModel } = makeService();
    (avatarModel as any).findById = jest.fn().mockResolvedValue(null);
    await expect(service.listMessages(manager, String(TABLE_ID), 1, 20, String(new Types.ObjectId()))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('listMessages : filtre expiresAt > now, tri createdAt desc, pagination', async () => {
    const messageModel = stubMessageChain();
    const { service, avatarModel } = makeService({ messageModel });
    (avatarModel as any).findOne = jest.fn().mockReturnValue({
      sort: jest.fn().mockResolvedValue(null),
    });
    const result = await service.listMessages(manager, String(TABLE_ID), 2, 10);
    const filter = messageModel.find.mock.calls[0][0];
    expect(filter.expiresAt).toEqual({ $gt: expect.any(Date) });
    const chain = messageModel.find.mock.results[0].value;
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.skip).toHaveBeenCalledWith(10);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(result.meta.page).toBe(2);
    expect(result.meta.total).toBe(1);
  });
});

describe('ChatService — purgeExpired (cron)', () => {
  it('lease non acquis : aucune suppression', async () => {
    const { service, avatarModel, messageModel, cronLease } = makeService();
    cronLease.acquire = jest.fn().mockResolvedValue(false);
    await service.purgeExpired();
    expect(cronLease.acquire).toHaveBeenCalledWith('chat.purge', 9 * 60 * 1000);
    expect(avatarModel.deleteMany).not.toHaveBeenCalled();
    expect(messageModel.deleteMany).not.toHaveBeenCalled();
  });

  it('avatars expirés : cascade sur leurs messages (from ET to)', async () => {
    const { service, avatarModel, messageModel } = makeService();
    const expiredId = new Types.ObjectId();
    (avatarModel as any).find = jest.fn().mockImplementation((filter: any) => {
      if (filter?.expiresAt) {
        return {
          select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: expiredId }]) }),
        };
      }
      // recherche des avatars vivants (messages orphelins)
      return {
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      };
    });
    (avatarModel as any).distinct = jest.fn().mockResolvedValue([]);
    (messageModel as any).distinct = jest.fn().mockResolvedValue([]);
    await service.purgeExpired();
    expect(messageModel.deleteMany).toHaveBeenCalledWith({
      $or: [{ fromAvatarId: { $in: [expiredId] } }, { toAvatarId: { $in: [expiredId] } }],
    });
    expect(avatarModel.deleteMany).toHaveBeenCalledWith({ _id: { $in: [expiredId] } });
  });

  it('avatars orphelins (position supprimée) : messages purgés + avatar:left émis, avatars valides intacts', async () => {
    const { service, avatarModel, messageModel, positionModel, emitSpies } = makeService();
    const orphanId = new Types.ObjectId();
    const aliveAvatarId = new Types.ObjectId();

    (avatarModel as any).find = jest.fn().mockImplementation((filter: any) => {
      if (filter?.expiresAt) {
        // aucun avatar expiré
        return {
          select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        };
      }
      if (filter?.positionId) {
        // avatars orphelins de la position supprimée
        return {
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([{ _id: orphanId, tableId: TABLE_ID }]),
          }),
        };
      }
      // avatars vivants pour la détection des messages orphelins
      return {
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: aliveAvatarId }]) }),
      };
    });
    // positionId référencés par les avatars : une position supprimée (orpheline).
    (avatarModel as any).distinct = jest.fn().mockResolvedValue([POSITION_ID]);
    // La position n'existe plus.
    (positionModel as any).find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });
    (messageModel as any).distinct = jest.fn().mockResolvedValue([]);

    await service.purgeExpired();

    expect(messageModel.deleteMany).toHaveBeenCalledWith({
      $or: [{ fromAvatarId: { $in: [orphanId] } }, { toAvatarId: { $in: [orphanId] } }],
    });
    expect(avatarModel.deleteMany).toHaveBeenCalledWith({ _id: { $in: [orphanId] } });
    expect(emitSpies.avatarLeft).toHaveBeenCalledWith(String(TABLE_ID), String(orphanId));
  });

  it('position toujours existante : avatars intacts', async () => {
    const { service, avatarModel, messageModel, positionModel, emitSpies } = makeService();
    (avatarModel as any).find = jest.fn().mockImplementation((filter: any) => {
      if (filter?.expiresAt) {
        return {
          select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      };
    });
    (avatarModel as any).distinct = jest.fn().mockResolvedValue([POSITION_ID]);
    (positionModel as any).find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: POSITION_ID }]) }),
    });
    (messageModel as any).distinct = jest.fn().mockResolvedValue([]);

    await service.purgeExpired();

    expect(avatarModel.deleteMany).not.toHaveBeenCalled();
    expect(messageModel.deleteMany).not.toHaveBeenCalled();
    expect(emitSpies.avatarLeft).not.toHaveBeenCalled();
  });

  it('messages orphelins (fromAvatarId sans avatar) : nettoyés', async () => {
    const { service, avatarModel, messageModel } = makeService();
    (avatarModel as any).find = jest.fn().mockImplementation((filter: any) => {
      if (filter?.expiresAt) {
        return {
          select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      };
    });
    (avatarModel as any).distinct = jest.fn().mockResolvedValue([]);
    const orphanMsgId = new Types.ObjectId();
    (messageModel as any).distinct = jest.fn().mockResolvedValue([orphanMsgId]);

    await service.purgeExpired();

    expect(messageModel.deleteMany).toHaveBeenCalledWith({ fromAvatarId: { $in: [orphanMsgId] } });
  });
});
