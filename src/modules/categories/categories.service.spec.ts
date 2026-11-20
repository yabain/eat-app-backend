import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CategoriesService } from './categories.service';

describe('CategoriesService — ordre d’affichage', () => {
  const a = new Types.ObjectId();
  const b = new Types.ObjectId();
  const c = new Types.ObjectId();

  let model: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    bulkWrite: jest.Mock;
    countDocuments: jest.Mock;
  };
  let service: CategoriesService;

  beforeEach(() => {
    model = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      bulkWrite: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    service = new CategoriesService(model as any);
  });

  it('trie les listes par order puis createdAt', async () => {
    const query: any = {
      sort: jest.fn(() => query),
      skip: jest.fn(() => query),
      limit: jest.fn().mockResolvedValue([]),
    };
    model.find.mockReturnValue(query);

    await service.findAll(1, 20);

    expect(model.find).toHaveBeenCalledWith({});
    expect(query.sort).toHaveBeenCalledWith({ order: 1, createdAt: 1 });
  });

  it('place une nouvelle catégorie à la fin', async () => {
    const last: any = {
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ order: 4 }),
        }),
      }),
    };
    model.findOne.mockReturnValue(last);
    model.create.mockImplementation(async (doc: any) => doc);

    const created = await service.create({ name: 'Boissons' } as any);

    expect(created.order).toBe(5);
  });

  it('normalise et échange deux positions (descendre)', async () => {
    const lean = jest.fn().mockResolvedValue([
      { _id: a, order: 0 },
      { _id: b, order: 0 },
      { _id: c, order: 0 },
    ]);
    model.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean }),
      }),
    });

    const result = await service.move(String(b), { direction: 'down' });

    expect(result).toEqual({ moved: true, order: 2 });
    const writes = model.bulkWrite.mock.calls[0][0];
    expect(writes).toEqual([
      { updateOne: { filter: { _id: a }, update: { $set: { order: 0 } } } },
      { updateOne: { filter: { _id: c }, update: { $set: { order: 1 } } } },
      { updateOne: { filter: { _id: b }, update: { $set: { order: 2 } } } },
    ]);
  });

  it('ne fait rien au-delà des bornes', async () => {
    const lean = jest.fn().mockResolvedValue([
      { _id: a, order: 0 },
      { _id: b, order: 1 },
    ]);
    model.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean }),
      }),
    });

    const result = await service.move(String(a), { direction: 'up' });

    expect(result).toEqual({ moved: false });
    expect(model.bulkWrite).not.toHaveBeenCalled();
  });

  it('renvoie 404 pour une catégorie inconnue', async () => {
    model.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: a, order: 0 }]),
        }),
      }),
    });

    await expect(
      service.move(String(b), { direction: 'up' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});