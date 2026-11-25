import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request = require('supertest');
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../../common/enums/roles.enum';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

const RESTAURANT_ID = new Types.ObjectId();
const ITEM_ID = new Types.ObjectId();

const managerUser = {
  sub: new Types.ObjectId().toString(),
  email: 'manager@resto.cm',
  role: UserRole.MANAGER,
  restaurantId: String(RESTAURANT_ID),
};
const clientUser = {
  sub: new Types.ObjectId().toString(),
  email: 'client@eat.cm',
  role: UserRole.CLIENT,
};

function validBody(overrides: Record<string, any> = {}) {
  return {
    restaurantId: String(RESTAURANT_ID),
    items: [{ menuItemId: String(ITEM_ID), quantity: 2 }],
    tableLabel: 'Table 3',
    ...overrides,
  };
}

describe('OrdersController — POST /orders/on-site (intégration)', () => {
  let app: INestApplication;
  let service: { createOnSite: jest.Mock };
  let currentUser: any;

  beforeAll(async () => {
    service = { createOnSite: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // Même configuration que main.ts
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    service.createOnSite.mockReset();
    service.createOnSite.mockResolvedValue({
      _id: new Types.ObjectId().toString(),
      orderNumber: 'ORD-TEST-1',
      orderType: 'on_site',
      pricingSnapshot: { paymentAmount: 2000 },
    });
  });

  it('201 manager authentifié : service appelé avec l\'utilisateur et le DTO', async () => {
    currentUser = managerUser;

    const res = await request(app.getHttpServer())
      .post('/orders/on-site')
      .send(validBody())
      .expect(201);

    expect(res.body.orderType).toBe('on_site');
    expect(service.createOnSite).toHaveBeenCalledTimes(1);
    const [actor, dto] = service.createOnSite.mock.calls[0];
    expect(actor).toBe(managerUser);
    expect(dto).toEqual(validBody());
  });

  it('403 client : le guard de rôle refuse avant d\'atteindre le service', async () => {
    currentUser = clientUser;

    await request(app.getHttpServer()).post('/orders/on-site').send(validBody()).expect(403);

    expect(service.createOnSite).not.toHaveBeenCalled();
  });

  it('400 DTO invalide : quantity 0 refusée par le ValidationPipe', async () => {
    currentUser = managerUser;

    await request(app.getHttpServer())
      .post('/orders/on-site')
      .send(validBody({ items: [{ menuItemId: String(ITEM_ID), quantity: 0 }] }))
      .expect(400);

    expect(service.createOnSite).not.toHaveBeenCalled();
  });

  it('400 DTO invalide : items vide refusé (ArrayMinSize(1))', async () => {
    currentUser = managerUser;

    await request(app.getHttpServer()).post('/orders/on-site').send(validBody({ items: [] })).expect(400);

    expect(service.createOnSite).not.toHaveBeenCalled();
  });

  it('400 DTO invalide : restaurantId absent ou mal formé', async () => {
    currentUser = managerUser;

    await request(app.getHttpServer())
      .post('/orders/on-site')
      .send(validBody({ restaurantId: 'not-a-mongoid' }))
      .expect(400);

    expect(service.createOnSite).not.toHaveBeenCalled();
  });
});
