import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/roles.enum';
import { TablesService } from './tables.service';
import { ChatRealtimeService } from '../chat/chat-realtime.service';

const RESTAURANT_ID = new Types.ObjectId();
const OTHER_RESTAURANT_ID = new Types.ObjectId();
const TABLE_ID = new Types.ObjectId();
const OTHER_TABLE_ID = new Types.ObjectId();
const POSITION_ID = new Types.ObjectId();
const AVATAR_ID = new Types.ObjectId();
const AVATAR_2_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();

const manager = {
  sub: String(USER_ID),
  email: 'manager@resto.cm',
  role: UserRole.MANAGER,
  restaurantId: String(RESTAURANT_ID),
};
const employee = { ...manager, email: 'employe@resto.cm', role: UserRole.EMPLOYEE };
const admin = { sub: String(USER_ID), email: 'admin@eat.cm', role: UserRole.ADMIN };

const table = {
  _id: TABLE_ID,
  restaurantId: RESTAURANT_ID,
  label: 'Table 3',
  isActive: true,
  save: jest.fn().mockResolvedValue(undefined),
};

function makeService(overrides: Record<string, any> = {}) {
  const tableModel: any = {
    create: jest.fn().mockImplementation(async (payload: any) => ({ _id: new Types.ObjectId(), ...payload })),
    findById: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn().mockResolvedValue(0),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };
  const positionModel: any = {
    create: jest.fn().mockImplementation(async (payload: any) => ({ _id: new Types.ObjectId(), ...payload })),
    findById: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 3 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };
  const avatarModel: any = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
  };
  const messageModel: any = {
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 5 }),
  };
  const restaurantModel: any = {
    findById: jest.fn().mockResolvedValue({ _id: OTHER_RESTAURANT_ID }),
  };
  const config = { get: jest.fn().mockReturnValue('http://localhost:4200') };
  const auditLogs: any = { record: jest.fn().mockResolvedValue(undefined) };
  const realtime = new ChatRealtimeService();
  const emitSpies = {
    tableRemoved: jest.spyOn(realtime, 'emitTableRemoved'),
    tableDeactivated: jest.spyOn(realtime, 'emitTableDeactivated'),
    avatarLeft: jest.spyOn(realtime, 'emitAvatarLeft'),
  };

  const service = new TablesService(
    overrides.tableModel || tableModel,
    overrides.positionModel || positionModel,
    overrides.avatarModel || avatarModel,
    overrides.messageModel || messageModel,
    overrides.restaurantModel || restaurantModel,
    realtime,
    auditLogs,
    overrides.config || config,
  );
  return {
    service,
    tableModel: overrides.tableModel || tableModel,
    positionModel: overrides.positionModel || positionModel,
    avatarModel: overrides.avatarModel || avatarModel,
    messageModel: overrides.messageModel || messageModel,
    restaurantModel: overrides.restaurantModel || restaurantModel,
    config: overrides.config || config,
    auditLogs,
    realtime,
    emitSpies,
  };
}

describe('TablesService — createTable', () => {
  it('manager : restaurantId forcé à son propre restaurant (dto ignoré)', async () => {
    const { service, tableModel } = makeService();
    await service.createTable(manager, { label: 'Table 3', restaurantId: String(OTHER_RESTAURANT_ID) });
    expect(tableModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: RESTAURANT_ID, label: 'Table 3', isActive: true }),
    );
  });

  it('manager sans restaurantId : 403', async () => {
    const { service } = makeService();
    await expect(service.createTable({ ...manager, restaurantId: undefined }, { label: 'Table 3' })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.createTable({ ...manager, restaurantId: undefined }, { label: 'Table 3' })).rejects.toThrow(
      'Compte manager sans restaurant',
    );
  });

  it('admin sans restaurantId : 400', async () => {
    const { service } = makeService();
    await expect(service.createTable(admin, { label: 'Table 3' })).rejects.toThrow(BadRequestException);
  });

  it('label whitespace : 400 (vide après trim)', async () => {
    const { service, tableModel } = makeService();
    await expect(service.createTable(manager, { label: '   ' })).rejects.toThrow(BadRequestException);
    await expect(service.createTable(manager, { label: '   ' })).rejects.toThrow('Label requis');
    expect(tableModel.create).not.toHaveBeenCalled();
  });

  it('label entouré d\'espaces : trimmé avant le create', async () => {
    const { service, tableModel } = makeService();
    await service.createTable(manager, { label: '  Table 3  ' });
    expect(tableModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Table 3' }),
    );
  });

  it('admin : restaurant inexistant → 404 (pas de table orpheline)', async () => {
    const { service, restaurantModel } = makeService();
    restaurantModel.findById = jest.fn().mockResolvedValue(null);
    await expect(service.createTable(admin, { label: 'Table 3', restaurantId: String(OTHER_RESTAURANT_ID) })).rejects.toThrow(
      NotFoundException,
    );
    expect(restaurantModel.findById).toHaveBeenCalledWith(String(OTHER_RESTAURANT_ID));
  });

  it('admin : restaurantId du dto utilisé (restaurant existant)', async () => {
    const { service, tableModel } = makeService();
    await service.createTable(admin, { label: 'Table 5', restaurantId: String(OTHER_RESTAURANT_ID) });
    expect(tableModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: OTHER_RESTAURANT_ID, label: 'Table 5' }),
    );
  });
});

describe('TablesService — listTables (scoping + positionCount)', () => {
  function stubList(tables: any[], counts: any[]) {
    const tableModel: any = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(tables),
      }),
      countDocuments: jest.fn().mockResolvedValue(tables.length),
    };
    const positionModel: any = {
      aggregate: jest.fn().mockResolvedValue(counts),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    return { tableModel, positionModel };
  }

  it('manager : scoping forcé à son restaurant, positionCount agrégé', async () => {
    const t1 = { _id: TABLE_ID, restaurantId: RESTAURANT_ID, label: 'Table 1' };
    const t2 = { _id: OTHER_TABLE_ID, restaurantId: RESTAURANT_ID, label: 'Table 2' };
    const { tableModel, positionModel } = stubList([t1, t2], [{ _id: TABLE_ID, count: 4 }]);
    const { service } = makeService({ tableModel, positionModel });
    const res = await service.listTables(manager);
    expect(tableModel.find).toHaveBeenCalledWith({ restaurantId: RESTAURANT_ID });
    expect(positionModel.aggregate).toHaveBeenCalledWith([
      { $match: { tableId: { $in: [TABLE_ID, OTHER_TABLE_ID] } } },
      { $group: { _id: '$tableId', count: { $sum: 1 } } },
    ]);
    expect(res.data[0].positionCount).toBe(4);
    expect(res.data[1].positionCount).toBe(0);
    expect(res.meta.total).toBe(2);
  });

  it('employee : lecture, scoping forcé à son restaurant', async () => {
    const { tableModel } = stubList([], []);
    const { service } = makeService({ tableModel });
    await service.listTables(employee);
    expect(tableModel.find).toHaveBeenCalledWith({ restaurantId: RESTAURANT_ID });
  });

  it('admin : sans filtre → toutes les tables ; avec restaurantId → filtré', async () => {
    const { tableModel } = stubList([], []);
    const { service } = makeService({ tableModel });
    await service.listTables(admin);
    expect(tableModel.find).toHaveBeenCalledWith({});
    await service.listTables(admin, String(OTHER_RESTAURANT_ID));
    expect(tableModel.find).toHaveBeenCalledWith({ restaurantId: OTHER_RESTAURANT_ID });
  });

  it('manager/employee sans restaurantId : liste vide (pas de crash)', async () => {
    const { service, tableModel } = makeService();
    const res = await service.listTables({ ...manager, restaurantId: undefined });
    expect(res.data).toEqual([]);
    expect(res.meta.total).toBe(0);
    expect(tableModel.find).not.toHaveBeenCalled();
  });
});

describe('TablesService — updateTable', () => {
  it('table introuvable : 404', async () => {
    const { service, tableModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(null);
    await expect(service.updateTable(manager, String(TABLE_ID), { label: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('manager hors de son restaurant : 404 (pas de révélation d\'existence)', async () => {
    const { service, tableModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue({ ...table, restaurantId: OTHER_RESTAURANT_ID });
    await expect(service.updateTable(manager, String(TABLE_ID), { label: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('label + isActive appliqués', async () => {
    const { service, tableModel } = makeService();
    const doc: any = { ...table, save: jest.fn().mockResolvedValue(undefined) };
    tableModel.findById = jest.fn().mockResolvedValue(doc);
    await service.updateTable(manager, String(TABLE_ID), { label: 'Table 12', isActive: false });
    expect(doc.label).toBe('Table 12');
    expect(doc.isActive).toBe(false);
    expect(doc.save).toHaveBeenCalled();
  });

  it('label whitespace : 400 (vide après trim)', async () => {
    const { service, tableModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    await expect(service.updateTable(manager, String(TABLE_ID), { label: '   ' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.updateTable(manager, String(TABLE_ID), { label: '   ' })).rejects.toThrow(
      'Label requis',
    );
  });

  it('label entouré d\'espaces : trimmé avant save', async () => {
    const { service, tableModel } = makeService();
    const doc: any = { ...table, save: jest.fn().mockResolvedValue(undefined) };
    tableModel.findById = jest.fn().mockResolvedValue(doc);
    await service.updateTable(manager, String(TABLE_ID), { label: '  Table 12  ' });
    expect(doc.label).toBe('Table 12');
  });
});

describe('TablesService — updateTable (table:deactivated)', () => {
  it('isActive: false → table:deactivated émis à la room table APRÈS la mise à jour DB', async () => {
    const { service, tableModel, emitSpies } = makeService();
    const doc: any = { ...table, save: jest.fn().mockResolvedValue(undefined) };
    tableModel.findById = jest.fn().mockResolvedValue(doc);
    await service.updateTable(manager, String(TABLE_ID), { isActive: false });
    expect(emitSpies.tableDeactivated).toHaveBeenCalledTimes(1);
    expect(emitSpies.tableDeactivated).toHaveBeenCalledWith(String(TABLE_ID));
    // Émission APRÈS la mise à jour DB (pattern de table:removed).
    expect(emitSpies.tableDeactivated.mock.invocationCallOrder[0]).toBeGreaterThan(
      doc.save.mock.invocationCallOrder[0],
    );
  });

  it('isActive: true (réactivation) → PAS d\'émission table:deactivated', async () => {
    const { service, tableModel, emitSpies } = makeService();
    const doc: any = { ...table, isActive: false, save: jest.fn().mockResolvedValue(undefined) };
    tableModel.findById = jest.fn().mockResolvedValue(doc);
    await service.updateTable(manager, String(TABLE_ID), { isActive: true });
    expect(doc.isActive).toBe(true);
    expect(emitSpies.tableDeactivated).not.toHaveBeenCalled();
  });

  it('update label seul → PAS d\'émission table:deactivated', async () => {
    const { service, tableModel, emitSpies } = makeService();
    const doc: any = { ...table, save: jest.fn().mockResolvedValue(undefined) };
    tableModel.findById = jest.fn().mockResolvedValue(doc);
    await service.updateTable(manager, String(TABLE_ID), { label: 'Table 12' });
    expect(emitSpies.tableDeactivated).not.toHaveBeenCalled();
  });
});

describe('TablesService — deleteTable (cascade)', () => {
  it('cascade : avatars + messages + positions supprimés, table ensuite, table:removed APRÈS la suppression DB', async () => {
    const { service, tableModel, avatarModel, messageModel, positionModel, emitSpies } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    const result = await service.deleteTable(manager, String(TABLE_ID));

    expect(avatarModel.deleteMany).toHaveBeenCalledWith({ tableId: TABLE_ID });
    expect(messageModel.deleteMany).toHaveBeenCalledWith({ tableId: TABLE_ID });
    expect(positionModel.deleteMany).toHaveBeenCalledWith({ tableId: TABLE_ID });
    expect(tableModel.deleteOne).toHaveBeenCalledWith({ _id: TABLE_ID });
    // Émission APRÈS la suppression DB (pas de client reconnecté sur une room morte).
    expect(emitSpies.tableRemoved.mock.invocationCallOrder[0]).toBeGreaterThan(
      tableModel.deleteOne.mock.invocationCallOrder[0],
    );
    expect(emitSpies.tableRemoved).toHaveBeenCalledWith(String(TABLE_ID));
    expect(result).toEqual({ deleted: true });
  });

  it('audit log enregistré (action destructive)', async () => {
    const { service, tableModel, auditLogs } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    await service.deleteTable(manager, String(TABLE_ID));
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: manager.sub,
        actorEmail: manager.email,
        actorRole: UserRole.MANAGER,
        action: 'table.deleted',
        resourceType: 'Table',
        resourceId: String(TABLE_ID),
        resourceLabel: 'Table 3',
      }),
    );
  });

  it('table introuvable : 404', async () => {
    const { service, tableModel, avatarModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(null);
    await expect(service.deleteTable(manager, String(TABLE_ID))).rejects.toThrow(NotFoundException);
    expect(avatarModel.deleteMany).not.toHaveBeenCalled();
  });

  it('manager hors de son restaurant : 404', async () => {
    const { service, tableModel, avatarModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue({ ...table, restaurantId: OTHER_RESTAURANT_ID });
    await expect(service.deleteTable(manager, String(TABLE_ID))).rejects.toThrow(NotFoundException);
    expect(avatarModel.deleteMany).not.toHaveBeenCalled();
  });
});

// (helpers) — aucun

describe('TablesService — createPosition (label auto + idQr)', () => {
  it('label vide : auto-généré « Siège N » (countDocuments + 1)', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.countDocuments = jest.fn().mockResolvedValue(2);
    await service.createPosition(manager, String(TABLE_ID), {});
    expect(positionModel.countDocuments).toHaveBeenCalledWith({ tableId: TABLE_ID });
    expect(positionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: TABLE_ID, restaurantId: RESTAURANT_ID, label: 'Siège 3', isActive: true }),
    );
    expect(String(positionModel.create.mock.calls[0][0].idQr)).toHaveLength(12);
  });

  it('label fourni : utilisé tel quel', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    await service.createPosition(manager, String(TABLE_ID), { label: 'Coin fenêtre' });
    expect(positionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Coin fenêtre' }),
    );
    expect(positionModel.countDocuments).not.toHaveBeenCalled();
  });

  it('label whitespace : auto-généré', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.countDocuments = jest.fn().mockResolvedValue(0);
    await service.createPosition(manager, String(TABLE_ID), { label: '   ' });
    expect(positionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Siège 1' }),
    );
  });

  it('table introuvable : 404', async () => {
    const { service, tableModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(null);
    await expect(service.createPosition(manager, String(TABLE_ID), {})).rejects.toThrow(NotFoundException);
  });

  it('table hors du restaurant du manager : 404', async () => {
    const { service, tableModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue({ ...table, restaurantId: OTHER_RESTAURANT_ID });
    await expect(service.createPosition(manager, String(TABLE_ID), {})).rejects.toThrow(NotFoundException);
  });

  it('collision idQr (11000) : retry puis succès', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    let calls = 0;
    positionModel.create = jest.fn().mockImplementation(async (payload: any) => {
      calls++;
      if (calls === 1) {
        const err: any = new Error('E11000');
        err.code = 11000;
        throw err;
      }
      return { _id: new Types.ObjectId(), ...payload };
    });
    const created = await service.createPosition(manager, String(TABLE_ID), { label: 'Siège 1' });
    expect(calls).toBe(2);
    expect(created.label).toBe('Siège 1');
  });

  it('collision idQr épuisée (3 retries) : 409 Conflict, jamais le 500 brut', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    let calls = 0;
    positionModel.create = jest.fn().mockImplementation(async () => {
      calls++;
      const err: any = new Error('E11000');
      err.code = 11000;
      throw err;
    });
    await expect(service.createPosition(manager, String(TABLE_ID), {})).rejects.toThrow(ConflictException);
    expect(calls).toBe(3);
  });

  it('erreur non 11000 : reprise telle quelle (pas de retry)', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.create = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(service.createPosition(manager, String(TABLE_ID), {})).rejects.toThrow('db down');
    expect(positionModel.create).toHaveBeenCalledTimes(1);
  });
});

describe('TablesService — listPositions (scoping via table)', () => {
  it('filtré par tableId, paginé', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ _id: POSITION_ID, label: 'Siège 1' }]),
    });
    positionModel.countDocuments = jest.fn().mockResolvedValue(1);
    const res = await service.listPositions(manager, String(TABLE_ID), 1, 20);
    expect(positionModel.find).toHaveBeenCalledWith({ tableId: TABLE_ID });
    expect(positionModel.find.mock.results[0].value.sort).toHaveBeenCalledWith({ createdAt: 1 });
    expect(res.data).toHaveLength(1);
    expect(res.meta.total).toBe(1);
  });

  it('table hors scope : 404', async () => {
    const { service, tableModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue({ ...table, restaurantId: OTHER_RESTAURANT_ID });
    await expect(service.listPositions(manager, String(TABLE_ID))).rejects.toThrow(NotFoundException);
  });

  it('table introuvable : 404', async () => {
    const { service, tableModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(null);
    await expect(service.listPositions(manager, String(TABLE_ID))).rejects.toThrow(NotFoundException);
  });
});

describe('TablesService — updatePosition', () => {
  it('position ∈ table : label/isActive appliqués', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    const doc: any = {
      _id: POSITION_ID,
      tableId: TABLE_ID,
      label: 'Siège 1',
      isActive: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    positionModel.findById = jest.fn().mockResolvedValue(doc);
    await service.updatePosition(manager, String(TABLE_ID), String(POSITION_ID), { label: 'Banquette', isActive: false });
    expect(doc.label).toBe('Banquette');
    expect(doc.isActive).toBe(false);
    expect(doc.save).toHaveBeenCalled();
  });

  it('label whitespace : 400 (vide après trim)', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    const doc: any = {
      _id: POSITION_ID,
      tableId: TABLE_ID,
      label: 'Siège 1',
      isActive: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    positionModel.findById = jest.fn().mockResolvedValue(doc);
    await expect(
      service.updatePosition(manager, String(TABLE_ID), String(POSITION_ID), { label: '   ' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updatePosition(manager, String(TABLE_ID), String(POSITION_ID), { label: '   ' }),
    ).rejects.toThrow('Label requis');
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('label entouré d\'espaces : trimmé avant save', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    const doc: any = {
      _id: POSITION_ID,
      tableId: TABLE_ID,
      label: 'Siège 1',
      isActive: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    positionModel.findById = jest.fn().mockResolvedValue(doc);
    await service.updatePosition(manager, String(TABLE_ID), String(POSITION_ID), { label: '  Banquette  ' });
    expect(doc.label).toBe('Banquette');
  });

  it('position d\'une autre table : 404', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.findById = jest.fn().mockResolvedValue({ _id: POSITION_ID, tableId: OTHER_TABLE_ID });
    await expect(
      service.updatePosition(manager, String(TABLE_ID), String(POSITION_ID), { label: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('position introuvable : 404', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.findById = jest.fn().mockResolvedValue(null);
    await expect(
      service.updatePosition(manager, String(TABLE_ID), String(POSITION_ID), { label: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('table hors scope : 404', async () => {
    const { service, tableModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue({ ...table, restaurantId: OTHER_RESTAURANT_ID });
    await expect(
      service.updatePosition(manager, String(TABLE_ID), String(POSITION_ID), { label: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('TablesService — deletePosition (cascade)', () => {
  it('cascade : avatars (y compris persistants) → leurs messages → avatar:left émis pour chaque avatar', async () => {
    const { service, tableModel, positionModel, avatarModel, messageModel, emitSpies, auditLogs } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.findById = jest.fn().mockResolvedValue({ _id: POSITION_ID, tableId: TABLE_ID, label: 'Siège 1' });
    avatarModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: AVATAR_ID }, { _id: AVATAR_2_ID }]),
      }),
    });

    const result = await service.deletePosition(manager, String(TABLE_ID), String(POSITION_ID));

    // Messages des avatars (from ET to) — pas les messages de groupe de la table entière.
    expect(messageModel.deleteMany).toHaveBeenCalledWith({
      $or: [{ fromAvatarId: { $in: [AVATAR_ID, AVATAR_2_ID] } }, { toAvatarId: { $in: [AVATAR_ID, AVATAR_2_ID] } }],
    });
    expect(avatarModel.deleteMany).toHaveBeenCalledWith({ positionId: POSITION_ID });
    expect(positionModel.deleteOne).toHaveBeenCalledWith({ _id: POSITION_ID });
    // Les autres positions de la table continuent le chat de groupe : la
    // suppression ne touche JAMAIS messageModel.deleteMany({ tableId }).
    expect(emitSpies.avatarLeft).toHaveBeenCalledTimes(2);
    expect(emitSpies.avatarLeft).toHaveBeenCalledWith(String(TABLE_ID), String(AVATAR_ID));
    expect(emitSpies.avatarLeft).toHaveBeenCalledWith(String(TABLE_ID), String(AVATAR_2_ID));
    // Émissions APRÈS la suppression DB.
    expect(emitSpies.avatarLeft.mock.invocationCallOrder[0]).toBeGreaterThan(
      positionModel.deleteOne.mock.invocationCallOrder[0],
    );
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'table_position.deleted',
        resourceType: 'TablePosition',
        resourceId: String(POSITION_ID),
      }),
    );
    expect(result).toEqual({ deleted: true, avatarsDeleted: 2, messagesDeleted: 5 });
  });

  it('position sans avatar : pas de suppression de messages', async () => {
    const { service, tableModel, positionModel, avatarModel, messageModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.findById = jest.fn().mockResolvedValue({ _id: POSITION_ID, tableId: TABLE_ID });
    avatarModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });
    await service.deletePosition(manager, String(TABLE_ID), String(POSITION_ID));
    expect(messageModel.deleteMany).not.toHaveBeenCalled();
    expect(avatarModel.deleteMany).toHaveBeenCalledWith({ positionId: POSITION_ID });
    expect(positionModel.deleteOne).toHaveBeenCalledWith({ _id: POSITION_ID });
  });

  it('position d\'une autre table : 404, aucune suppression', async () => {
    const { service, tableModel, positionModel, avatarModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.findById = jest.fn().mockResolvedValue({ _id: POSITION_ID, tableId: OTHER_TABLE_ID });
    await expect(service.deletePosition(manager, String(TABLE_ID), String(POSITION_ID))).rejects.toThrow(
      NotFoundException,
    );
    expect(avatarModel.deleteMany).not.toHaveBeenCalled();
    expect(positionModel.deleteOne).not.toHaveBeenCalled();
  });
});

describe('TablesService — positionQr', () => {
  it('URL = FRONTEND_URL/restaurant/yChat?idQr=... et dataUrl générée', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.findById = jest.fn().mockResolvedValue({
      _id: POSITION_ID,
      tableId: TABLE_ID,
      idQr: 'AbCdEfGh1234',
      label: 'Siège 1',
    });
    const result = await service.positionQr(manager, String(TABLE_ID), String(POSITION_ID));
    expect(result.url).toBe('http://localhost:4200/restaurant/yChat?idQr=AbCdEfGh1234');
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('position d\'une autre table : 404', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.findById = jest.fn().mockResolvedValue({ _id: POSITION_ID, tableId: OTHER_TABLE_ID, idQr: 'x' });
    await expect(service.positionQr(manager, String(TABLE_ID), String(POSITION_ID))).rejects.toThrow(NotFoundException);
  });

  it('table hors scope : 404', async () => {
    const { service, tableModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue({ ...table, restaurantId: OTHER_RESTAURANT_ID });
    await expect(service.positionQr(manager, String(TABLE_ID), String(POSITION_ID))).rejects.toThrow(NotFoundException);
  });

  it('FRONTEND_URL non configurée : fallback localhost + warn logger (n5)', async () => {
    const { service, tableModel, positionModel, config } = makeService({
      config: { get: jest.fn().mockReturnValue('') },
    });
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.findById = jest.fn().mockResolvedValue({
      _id: POSITION_ID,
      tableId: TABLE_ID,
      idQr: 'AbCdEfGh1234',
      label: 'Siège 1',
    });
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const result = await service.positionQr(manager, String(TABLE_ID), String(POSITION_ID));
    expect(result.url).toBe('http://localhost:4200/restaurant/yChat?idQr=AbCdEfGh1234');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('FRONTEND_URL non configurée'));
  });

  it('FRONTEND_URL configurée : pas de warn', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    positionModel.findById = jest.fn().mockResolvedValue({
      _id: POSITION_ID,
      tableId: TABLE_ID,
      idQr: 'AbCdEfGh1234',
      label: 'Siège 1',
    });
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await service.positionQr(manager, String(TABLE_ID), String(POSITION_ID));
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('TablesService — ids Mongo invalides (400, pas de CastError 500)', () => {
  it('updateTable : id invalide → 400', async () => {
    const { service, tableModel } = makeService();
    await expect(service.updateTable(manager, 'not-an-id', { label: 'X' })).rejects.toThrow(BadRequestException);
    expect(tableModel.findById).not.toHaveBeenCalled();
  });

  it('deleteTable : id invalide → 400, aucune suppression', async () => {
    const { service, tableModel, avatarModel, positionModel, messageModel } = makeService();
    await expect(service.deleteTable(manager, 'not-an-id')).rejects.toThrow(BadRequestException);
    expect(tableModel.findById).not.toHaveBeenCalled();
    expect(avatarModel.deleteMany).not.toHaveBeenCalled();
    expect(positionModel.deleteMany).not.toHaveBeenCalled();
    expect(messageModel.deleteMany).not.toHaveBeenCalled();
  });

  it('createPosition : tableId invalide → 400', async () => {
    const { service, tableModel, positionModel } = makeService();
    await expect(service.createPosition(manager, 'not-an-id', {})).rejects.toThrow(BadRequestException);
    expect(tableModel.findById).not.toHaveBeenCalled();
    expect(positionModel.create).not.toHaveBeenCalled();
  });

  it('listPositions : tableId invalide → 400', async () => {
    const { service, tableModel } = makeService();
    await expect(service.listPositions(manager, 'not-an-id')).rejects.toThrow(BadRequestException);
    expect(tableModel.findById).not.toHaveBeenCalled();
  });

  it('updatePosition : tableId invalide → 400', async () => {
    const { service, tableModel, positionModel } = makeService();
    await expect(
      service.updatePosition(manager, 'not-an-id', String(POSITION_ID), { label: 'X' }),
    ).rejects.toThrow(BadRequestException);
    expect(tableModel.findById).not.toHaveBeenCalled();
    expect(positionModel.findById).not.toHaveBeenCalled();
  });

  it('updatePosition : id position invalide → 400', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    await expect(
      service.updatePosition(manager, String(TABLE_ID), 'not-an-id', { label: 'X' }),
    ).rejects.toThrow(BadRequestException);
    expect(positionModel.findById).not.toHaveBeenCalled();
  });

  it('deletePosition : tableId invalide → 400', async () => {
    const { service, tableModel, positionModel } = makeService();
    await expect(service.deletePosition(manager, 'not-an-id', String(POSITION_ID))).rejects.toThrow(
      BadRequestException,
    );
    expect(tableModel.findById).not.toHaveBeenCalled();
    expect(positionModel.findById).not.toHaveBeenCalled();
  });

  it('deletePosition : id position invalide → 400', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    await expect(service.deletePosition(manager, String(TABLE_ID), 'not-an-id')).rejects.toThrow(
      BadRequestException,
    );
    expect(positionModel.findById).not.toHaveBeenCalled();
  });

  it('positionQr : tableId invalide → 400', async () => {
    const { service, tableModel, positionModel } = makeService();
    await expect(service.positionQr(manager, 'not-an-id', String(POSITION_ID))).rejects.toThrow(BadRequestException);
    expect(tableModel.findById).not.toHaveBeenCalled();
    expect(positionModel.findById).not.toHaveBeenCalled();
  });

  it('positionQr : id position invalide → 400', async () => {
    const { service, tableModel, positionModel } = makeService();
    tableModel.findById = jest.fn().mockResolvedValue(table);
    await expect(service.positionQr(manager, String(TABLE_ID), 'not-an-id')).rejects.toThrow(BadRequestException);
    expect(positionModel.findById).not.toHaveBeenCalled();
  });
});
