import { INestApplication, NotFoundException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request = require('supertest');
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../../common/enums/roles.enum';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

const RESTAURANT_ID = new Types.ObjectId();
const TABLE_ID = new Types.ObjectId();

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

describe('ChatController — intégration (supertest)', () => {
  let app: INestApplication;
  let service: any;
  let currentUser: any;

  beforeAll(async () => {
    service = {
      findPositionByQr: jest.fn(),
      findTableById: jest.fn(),
      createAvatar: jest.fn(),
      listAvatars: jest.fn(),
      deleteAvatar: jest.fn(),
      createMessage: jest.fn(),
      listMessages: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: service }],
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
    currentUser = clientUser;
  });

  // ------------------------------------------------------------------
  // Résolution QR (by-qr) — surface publique du scan yChat
  // ------------------------------------------------------------------

  it('GET /chat/positions/by-qr/:idQr : 200 client authentifié, { position, tableId, restaurantId }', async () => {
    currentUser = clientUser;
    service.findPositionByQr.mockResolvedValue({
      position: { _id: 'p1', tableId: String(TABLE_ID) },
      tableId: String(TABLE_ID),
      restaurantId: String(RESTAURANT_ID),
    });
    const res = await request(app.getHttpServer()).get('/chat/positions/by-qr/AbCdEfGh1234').expect(200);
    expect(res.body.tableId).toBe(String(TABLE_ID));
    expect(res.body.restaurantId).toBe(String(RESTAURANT_ID));
    expect(service.findPositionByQr).toHaveBeenCalledWith('AbCdEfGh1234');
  });

  it('GET /chat/positions/by-qr/:idQr : 404 quand le service lève NotFound', async () => {
    currentUser = clientUser;
    service.findPositionByQr.mockRejectedValue(new NotFoundException('Position introuvable'));
    await request(app.getHttpServer()).get('/chat/positions/by-qr/AbCdEfGh1234').expect(404);
  });

  it('GET /chat/positions/by-qr/:idQr : 401 sans session', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: service }],
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
    await request(anon.getHttpServer()).get('/chat/positions/by-qr/AbCdEfGh1234').expect(401);
    await anon.close();
  });

  // ------------------------------------------------------------------
  // Avatars — validation DTO
  // ------------------------------------------------------------------

  const validAvatar = {
    positionId: String(new Types.ObjectId()),
    pseudo: 'Jean237',
    sex: 'M',
    photoUrl: '/uploads/avatars/avatar-m-1.png',
  };

  it('POST /chat/avatars : 201, service appelé avec actor + dto', async () => {
    currentUser = clientUser;
    service.createAvatar.mockResolvedValue({ _id: 'a1', pseudo: 'Jean237' });
    const res = await request(app.getHttpServer()).post('/chat/avatars').send(validAvatar).expect(201);
    expect(res.body.pseudo).toBe('Jean237');
    const [actor, dto] = service.createAvatar.mock.calls[0];
    expect(actor).toEqual(clientUser);
    expect(dto).toEqual(validAvatar);
  });

  it('POST /chat/avatars : 400 pseudo non alphanumérique (espace, emoji)', async () => {
    currentUser = clientUser;
    for (const pseudo of ['Jean 237', 'Jean😊']) {
      await request(app.getHttpServer()).post('/chat/avatars').send({ ...validAvatar, pseudo }).expect(400);
    }
    expect(service.createAvatar).not.toHaveBeenCalled();
  });

  it('POST /chat/avatars : 400 positionId absent ou non mongoId', async () => {
    currentUser = clientUser;
    await request(app.getHttpServer()).post('/chat/avatars').send({ ...validAvatar, positionId: 'abc' }).expect(400);
    await request(app.getHttpServer())
      .post('/chat/avatars')
      .send({ pseudo: 'Jean237', sex: 'M', photoUrl: '/a.png' })
      .expect(400);
    expect(service.createAvatar).not.toHaveBeenCalled();
  });

  it('GET /chat/avatars : 200 sans tableId (400 géré par le service), param transmis', async () => {
    currentUser = clientUser;
    service.listAvatars.mockResolvedValue([{ _id: 'a1', pseudo: 'Jean237' }]);
    const res = await request(app.getHttpServer()).get('/chat/avatars?tableId=abc').expect(200);
    expect(service.listAvatars).toHaveBeenCalledWith(clientUser, 'abc');
    expect(res.body).toHaveLength(1);
  });

  it('DELETE /chat/avatars/:id : 200, service appelé avec actor + id', async () => {
    currentUser = clientUser;
    service.deleteAvatar.mockResolvedValue({ deleted: true, messagesDeleted: 3 });
    const res = await request(app.getHttpServer()).delete(`/chat/avatars/${new Types.ObjectId()}`).expect(200);
    expect(res.body.deleted).toBe(true);
    expect(service.deleteAvatar).toHaveBeenCalledWith(clientUser, expect.any(String));
  });

  // ------------------------------------------------------------------
  // Messages — validation DTO + liste
  // ------------------------------------------------------------------

  it('POST /chat/messages : 201, service appelé ; 400 content > 1000 ; 400 fromAvatarId non mongoId', async () => {
    currentUser = clientUser;
    const tableId = String(TABLE_ID);
    service.createMessage.mockResolvedValue({ _id: 'm1', content: 'Salut' });
    const res = await request(app.getHttpServer())
      .post('/chat/messages')
      .send({ tableId, fromAvatarId: String(new Types.ObjectId()), content: 'Salut' })
      .expect(201);
    expect(res.body.content).toBe('Salut');

    await request(app.getHttpServer())
      .post('/chat/messages')
      .send({ tableId, fromAvatarId: String(new Types.ObjectId()), content: 'x'.repeat(1001) })
      .expect(400);
    await request(app.getHttpServer())
      .post('/chat/messages')
      .send({ tableId, fromAvatarId: 'abc', content: 'Salut' })
      .expect(400);
    expect(service.createMessage).toHaveBeenCalledTimes(1);
  });

  it('POST /chat/messages : 400 tableId manquant ou non mongoId', async () => {
    currentUser = clientUser;
    const fromAvatarId = String(new Types.ObjectId());
    await request(app.getHttpServer())
      .post('/chat/messages')
      .send({ fromAvatarId, content: 'Salut' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/chat/messages')
      .send({ tableId: 'abc', fromAvatarId, content: 'Salut' })
      .expect(400);
    expect(service.createMessage).not.toHaveBeenCalled();
  });

  it('GET /chat/messages : 200 paginé, actor + tableId + avatarId transmis', async () => {
    currentUser = clientUser;
    service.listMessages.mockResolvedValue({
      data: [{ _id: 'm1' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasPrevPage: false, hasNextPage: false },
    });
    const avatarId = new Types.ObjectId().toString();
    const res = await request(app.getHttpServer())
      .get(`/chat/messages?tableId=${TABLE_ID}&page=1&limit=20&avatarId=${avatarId}`)
      .expect(200);
    expect(service.listMessages).toHaveBeenCalledWith(clientUser, String(TABLE_ID), 1, 20, avatarId);
    expect(res.body.data).toHaveLength(1);
  });
});
