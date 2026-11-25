import { INestApplication, NotFoundException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request = require('supertest');
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../../common/enums/roles.enum';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';

const RESTAURANT_ID = new Types.ObjectId();

const adminUser = {
  sub: new Types.ObjectId().toString(),
  email: 'admin@eat.cm',
  role: UserRole.ADMIN,
};
const managerUser = {
  sub: new Types.ObjectId().toString(),
  email: 'manager@resto.cm',
  role: UserRole.MANAGER,
  restaurantId: String(RESTAURANT_ID),
};
const employeeUser = {
  sub: new Types.ObjectId().toString(),
  email: 'employe@resto.cm',
  role: UserRole.EMPLOYEE,
  restaurantId: String(RESTAURANT_ID),
};
const clientUser = {
  sub: new Types.ObjectId().toString(),
  email: 'client@eat.cm',
  role: UserRole.CLIENT,
};

describe('TablesController — intégration (supertest)', () => {
  let app: INestApplication;
  let service: any;
  let currentUser: any;

  beforeAll(async () => {
    service = {
      createTable: jest.fn(),
      listTables: jest.fn(),
      updateTable: jest.fn(),
      deleteTable: jest.fn(),
      createPosition: jest.fn(),
      listPositions: jest.fn(),
      updatePosition: jest.fn(),
      deletePosition: jest.fn(),
      positionQr: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TablesController],
      providers: [{ provide: TablesService, useValue: service }],
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
    Object.values(service).forEach((fn: any) => fn.mockReset());
    currentUser = managerUser;
  });

  // ------------------------------------------------------------------
  // Tables — rôles + DTO
  // ------------------------------------------------------------------

  it('POST /tables : 201 manager, service appelé avec actor + dto', async () => {
    currentUser = managerUser;
    service.createTable.mockResolvedValue({ _id: 't1', label: 'Table 3' });
    const res = await request(app.getHttpServer()).post('/tables').send({ label: 'Table 3' }).expect(201);
    expect(res.body.label).toBe('Table 3');
    const [actor, dto] = service.createTable.mock.calls[0];
    expect(actor).toEqual(managerUser);
    expect(dto.label).toBe('Table 3');
  });

  it('POST /tables : 403 client (RolesGuard avant le service)', async () => {
    currentUser = clientUser;
    await request(app.getHttpServer()).post('/tables').send({ label: 'Table 3' }).expect(403);
    expect(service.createTable).not.toHaveBeenCalled();
  });

  it('POST /tables : 403 employee (écriture interdite)', async () => {
    currentUser = employeeUser;
    await request(app.getHttpServer()).post('/tables').send({ label: 'Table 3' }).expect(403);
    expect(service.createTable).not.toHaveBeenCalled();
  });

  it('POST /tables : 400 label vide / trop long / non string', async () => {
    currentUser = managerUser;
    await request(app.getHttpServer()).post('/tables').send({ label: '' }).expect(400);
    await request(app.getHttpServer()).post('/tables').send({ label: 'x'.repeat(101) }).expect(400);
    await request(app.getHttpServer()).post('/tables').send({ label: 42 }).expect(400);
    expect(service.createTable).not.toHaveBeenCalled();
  });

  it('POST /tables : 400 restaurantId non mongoId (admin)', async () => {
    currentUser = adminUser;
    await request(app.getHttpServer())
      .post('/tables')
      .send({ label: 'Table 3', restaurantId: 'not-a-mongoid' })
      .expect(400);
    expect(service.createTable).not.toHaveBeenCalled();
  });

  it('POST /tables : whitelist — champs inconnus retirés du dto', async () => {
    currentUser = managerUser;
    service.createTable.mockResolvedValue({ _id: 't1' });
    await request(app.getHttpServer()).post('/tables').send({ label: 'Table 3', hack: 'x' }).expect(201);
    const dto = service.createTable.mock.calls[0][1];
    expect(dto).toEqual({ label: 'Table 3' });
  });

  it('GET /tables : 200 manager/employee (lecture), scoping transmis', async () => {
    currentUser = managerUser;
    service.listTables.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasPrevPage: false, hasNextPage: false },
    });
    const res = await request(app.getHttpServer()).get('/tables').expect(200);
    expect(service.listTables).toHaveBeenCalledWith(managerUser, undefined, 1, 20);
    expect(res.body.data).toEqual([]);

    currentUser = employeeUser;
    await request(app.getHttpServer()).get('/tables').expect(200);
    expect(service.listTables).toHaveBeenLastCalledWith(employeeUser, undefined, 1, 20);
  });

  it('GET /tables : 403 client', async () => {
    currentUser = clientUser;
    await request(app.getHttpServer()).get('/tables').expect(403);
    expect(service.listTables).not.toHaveBeenCalled();
  });

  it('GET /tables : query restaurantId + pagination transmis (admin), positionCount présent', async () => {
    currentUser = adminUser;
    service.listTables.mockResolvedValue({
      data: [{ _id: 't1', label: 'Table 1', positionCount: 4 }],
      meta: { page: 2, limit: 5, total: 1, totalPages: 1, hasPrevPage: true, hasNextPage: false },
    });
    const res = await request(app.getHttpServer())
      .get(`/tables?restaurantId=${RESTAURANT_ID}&page=2&limit=5`)
      .expect(200);
    expect(service.listTables).toHaveBeenCalledWith(adminUser, String(RESTAURANT_ID), 2, 5);
    expect(res.body.data[0].positionCount).toBe(4);
  });

  it('GET /tables : 400 restaurantId non mongoId', async () => {
    currentUser = adminUser;
    await request(app.getHttpServer()).get('/tables?restaurantId=abc').expect(400);
    expect(service.listTables).not.toHaveBeenCalled();
  });

  it('PATCH /tables/:id : 403 client, 200 manager', async () => {
    currentUser = clientUser;
    await request(app.getHttpServer()).patch('/tables/xyz').send({ isActive: false }).expect(403);
    expect(service.updateTable).not.toHaveBeenCalled();

    currentUser = managerUser;
    service.updateTable.mockResolvedValue({ _id: 't1', isActive: false });
    await request(app.getHttpServer())
      .patch(`/tables/${new Types.ObjectId()}`)
      .send({ isActive: false })
      .expect(200);
    expect(service.updateTable).toHaveBeenCalled();
  });

  it('PATCH /tables/:id : 400 isActive non booléen', async () => {
    currentUser = managerUser;
    await request(app.getHttpServer())
      .patch(`/tables/${new Types.ObjectId()}`)
      .send({ isActive: 'peut-être' })
      .expect(400);
    expect(service.updateTable).not.toHaveBeenCalled();
  });

  it('DELETE /tables/:id : 200 manager, 403 employee/client', async () => {
    currentUser = managerUser;
    service.deleteTable.mockResolvedValue({ deleted: true });
    await request(app.getHttpServer()).delete(`/tables/${new Types.ObjectId()}`).expect(200);
    expect(service.deleteTable).toHaveBeenCalledTimes(1);

    currentUser = employeeUser;
    await request(app.getHttpServer()).delete(`/tables/${new Types.ObjectId()}`).expect(403);
    currentUser = clientUser;
    await request(app.getHttpServer()).delete(`/tables/${new Types.ObjectId()}`).expect(403);
    expect(service.deleteTable).toHaveBeenCalledTimes(1);
  });

  it('DELETE /tables/:id : 404 quand le service lève NotFound (scoping)', async () => {
    currentUser = managerUser;
    service.deleteTable.mockRejectedValue(new NotFoundException('Table introuvable'));
    await request(app.getHttpServer()).delete(`/tables/${new Types.ObjectId()}`).expect(404);
  });

  // ------------------------------------------------------------------
  // Positions d'une table — rôles + DTO
  // ------------------------------------------------------------------

  it('POST /tables/:tableId/positions : 201 manager, 403 employee, 400 label trop long', async () => {
    const tableId = new Types.ObjectId().toString();
    currentUser = managerUser;
    service.createPosition.mockResolvedValue({ _id: 'p1', label: 'Siège 1' });
    const res = await request(app.getHttpServer())
      .post(`/tables/${tableId}/positions`)
      .send({ label: 'Siège 1' })
      .expect(201);
    expect(res.body.label).toBe('Siège 1');
    const [actor, pathTableId, dto] = service.createPosition.mock.calls[0];
    expect(actor).toEqual(managerUser);
    expect(pathTableId).toBe(tableId);
    expect(dto.label).toBe('Siège 1');

    currentUser = employeeUser;
    await request(app.getHttpServer()).post(`/tables/${tableId}/positions`).send({}).expect(403);
    expect(service.createPosition).toHaveBeenCalledTimes(1);

    currentUser = managerUser;
    await request(app.getHttpServer())
      .post(`/tables/${tableId}/positions`)
      .send({ label: 'x'.repeat(101) })
      .expect(400);
    expect(service.createPosition).toHaveBeenCalledTimes(1);
  });

  it('POST /tables/:tableId/positions : 201 sans label (auto « Siège N » côté service)', async () => {
    currentUser = managerUser;
    service.createPosition.mockResolvedValue({ _id: 'p1', label: 'Siège 1' });
    const tableId = new Types.ObjectId().toString();
    await request(app.getHttpServer()).post(`/tables/${tableId}/positions`).send({}).expect(201);
    const dto = service.createPosition.mock.calls[0][2];
    expect(dto.label).toBeUndefined();
  });

  it('GET /tables/:tableId/positions : 200 manager/employee, 403 client', async () => {
    const tableId = new Types.ObjectId().toString();
    currentUser = managerUser;
    service.listPositions.mockResolvedValue({
      data: [{ _id: 'p1', label: 'Siège 1' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasPrevPage: false, hasNextPage: false },
    });
    const res = await request(app.getHttpServer()).get(`/tables/${tableId}/positions`).expect(200);
    expect(service.listPositions).toHaveBeenCalledWith(managerUser, tableId, 1, 20);
    expect(res.body.data).toHaveLength(1);

    currentUser = employeeUser;
    await request(app.getHttpServer()).get(`/tables/${tableId}/positions`).expect(200);

    currentUser = clientUser;
    await request(app.getHttpServer()).get(`/tables/${tableId}/positions`).expect(403);
    expect(service.listPositions).toHaveBeenCalledTimes(2);
  });

  it('GET /tables/:tableId/positions : 404 quand le service lève NotFound (scoping)', async () => {
    currentUser = managerUser;
    service.listPositions.mockRejectedValue(new NotFoundException('Table introuvable'));
    await request(app.getHttpServer()).get(`/tables/${new Types.ObjectId()}/positions`).expect(404);
  });

  it('PATCH /tables/:tableId/positions/:id : 200 manager, 403 client, 400 isActive non booléen', async () => {
    const tableId = new Types.ObjectId().toString();
    const positionId = new Types.ObjectId().toString();
    currentUser = managerUser;
    service.updatePosition.mockResolvedValue({ _id: positionId, label: 'Banquette' });
    await request(app.getHttpServer())
      .patch(`/tables/${tableId}/positions/${positionId}`)
      .send({ label: 'Banquette' })
      .expect(200);
    expect(service.updatePosition).toHaveBeenCalledWith(managerUser, tableId, positionId, { label: 'Banquette' });

    currentUser = clientUser;
    await request(app.getHttpServer())
      .patch(`/tables/${tableId}/positions/${positionId}`)
      .send({ label: 'X' })
      .expect(403);

    currentUser = managerUser;
    await request(app.getHttpServer())
      .patch(`/tables/${tableId}/positions/${positionId}`)
      .send({ isActive: 'peut-être' })
      .expect(400);
    expect(service.updatePosition).toHaveBeenCalledTimes(1);
  });

  it('DELETE /tables/:tableId/positions/:id : 200 manager, 403 employee', async () => {
    const tableId = new Types.ObjectId().toString();
    const positionId = new Types.ObjectId().toString();
    currentUser = managerUser;
    service.deletePosition.mockResolvedValue({ deleted: true, avatarsDeleted: 0, messagesDeleted: 0 });
    await request(app.getHttpServer()).delete(`/tables/${tableId}/positions/${positionId}`).expect(200);
    expect(service.deletePosition).toHaveBeenCalledWith(managerUser, tableId, positionId);

    currentUser = employeeUser;
    await request(app.getHttpServer()).delete(`/tables/${tableId}/positions/${positionId}`).expect(403);
    expect(service.deletePosition).toHaveBeenCalledTimes(1);
  });

  it('GET /tables/:tableId/positions/:id/qr : 200 manager avec { dataUrl, url }, 403 client', async () => {
    const tableId = new Types.ObjectId().toString();
    const positionId = new Types.ObjectId().toString();
    currentUser = managerUser;
    service.positionQr.mockResolvedValue({
      dataUrl: 'data:image/png;base64,abc',
      url: 'http://localhost:4200/restaurant/yChat?idQr=AbCdEfGh1234',
    });
    const res = await request(app.getHttpServer())
      .get(`/tables/${tableId}/positions/${positionId}/qr`)
      .expect(200);
    expect(service.positionQr).toHaveBeenCalledWith(managerUser, tableId, positionId);
    expect(res.body.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.body.url).toContain('/restaurant/yChat?idQr=');

    currentUser = clientUser;
    await request(app.getHttpServer())
      .get(`/tables/${tableId}/positions/${positionId}/qr`)
      .expect(403);
    expect(service.positionQr).toHaveBeenCalledTimes(1);
  });

  it('GET /tables/:tableId/positions/:id/qr : 404 quand le service lève NotFound (position hors table)', async () => {
    currentUser = managerUser;
    service.positionQr.mockRejectedValue(new NotFoundException('Position introuvable'));
    await request(app.getHttpServer())
      .get(`/tables/${new Types.ObjectId()}/positions/${new Types.ObjectId()}/qr`)
      .expect(404);
  });

  it('401 sans session (guard override qui refuse)', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TablesController],
      providers: [{ provide: TablesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: () => {
          throw new UnauthorizedException('Session requise');
        },
      })
      .compile();
    const anon = moduleRef.createNestApplication();
    anon.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await anon.init();
    await request(anon.getHttpServer()).get('/tables').expect(401);
    await anon.close();
  });
});
