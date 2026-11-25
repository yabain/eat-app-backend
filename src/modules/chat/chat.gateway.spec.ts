import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { ChatGateway } from './chat.gateway';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatService } from './chat.service';
import { isAllowedCorsOrigin, buildCorsOrigins, CORS_METHODS, corsAllowedHeaders } from '../../common/utils/cors.util';

/**
 * Copie du middleware de pré-vol OPTIONS de main.ts : sert à prouver la
 * cohabitation engine.io ⇄ middleware maison. engine.io s'attache au listener
 * HTTP avant Express ; le handshake GET/POST doit traverser ce middleware.
 */
function optionsMiddleware(req: any, res: any, next: any) {
  const allowedOrigins = buildCorsOrigins();
  const origin = req.headers.origin;
  const isAllowed = typeof origin === 'string' && isAllowedCorsOrigin(origin, allowedOrigins);
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  next();
}

const TABLE_ID = new Types.ObjectId().toString();
const OTHER_TABLE_ID = new Types.ObjectId().toString();
const POSITION_ID = new Types.ObjectId().toString();
const AVATAR_A_ID = new Types.ObjectId().toString();
const AVATAR_B_ID = new Types.ObjectId().toString();
const AVATAR_OTHER_TABLE_ID = new Types.ObjectId().toString();
const OWNER_USER_ID = new Types.ObjectId().toString();
const OTHER_USER_ID = new Types.ObjectId().toString();

function waitFor<T>(fn: () => boolean, timeoutMs = 5000): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (fn()) {
        clearInterval(timer);
        resolve(undefined);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor timeout'));
      }
    }, 25);
  });
}

describe('ChatGateway — rooms par table + events', () => {
  let app: INestApplication;
  let realtime: ChatRealtimeService;
  let port: number;

  beforeAll(async () => {
    const table = { _id: TABLE_ID, restaurantId: new Types.ObjectId(), label: 'Table 3', isActive: true };
    const inactiveTable = { _id: OTHER_TABLE_ID, restaurantId: new Types.ObjectId(), label: 'Table 9', isActive: false };
    const positions = { [POSITION_ID]: { _id: POSITION_ID, tableId: TABLE_ID, isActive: true } };
    const avatars: Record<string, any> = {
      [AVATAR_A_ID]: { _id: AVATAR_A_ID, tableId: TABLE_ID, positionId: POSITION_ID, userId: OWNER_USER_ID },
      [AVATAR_B_ID]: { _id: AVATAR_B_ID, tableId: TABLE_ID, positionId: POSITION_ID, userId: OTHER_USER_ID },
      [AVATAR_OTHER_TABLE_ID]: {
        _id: AVATAR_OTHER_TABLE_ID,
        tableId: OTHER_TABLE_ID,
        positionId: new Types.ObjectId().toString(),
        userId: OWNER_USER_ID,
      },
    };
    const chatService = {
      findTableById: jest.fn().mockImplementation(async (id: string) => {
        if (id === TABLE_ID) return table;
        if (id === OTHER_TABLE_ID) return inactiveTable;
        return null;
      }),
      findPositionById: jest.fn().mockImplementation(async (id: string) => positions[id] || null),
      findAvatarById: jest.fn().mockImplementation(async (id: string) => avatars[id] || null),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'chat-test-secret' })],
      providers: [ChatGateway, ChatRealtimeService, { provide: ChatService, useValue: chatService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(optionsMiddleware);
    await app.listen(0);
    port = (app.getHttpServer() as any).address().port;
    realtime = app.get(ChatRealtimeService);
  });

  afterAll(async () => {
    await app.close();
  });

  function connectClient(): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${port}`, {
        path: '/socket.io',
        extraHeaders: { Origin: 'http://localhost:4200' },
      });
      client.on('connect', () => resolve(client));
      client.on('connect_error', (err) => reject(err));
      client.onAny(() => {
        /* absorbe les événements non surveillés */
      });
    });
  }

  function connectClientWithToken(token: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${port}`, {
        path: '/socket.io',
        auth: { token },
        extraHeaders: { Origin: 'http://localhost:4200' },
      });
      client.on('connect', () => resolve(client));
      client.on('connect_error', (err) => reject(err));
      client.onAny(() => {
        /* absorbe les événements non surveillés */
      });
    });
  }

  function join(client: ClientSocket, payload: Record<string, any>): Promise<any> {
    return new Promise((resolve) => client.emit('join', payload, resolve));
  }

  /** Token JWT signé — flux légitime : l'association avatar exige le userId du token. */
  function tokenFor(userId: string): string {
    return app.get(JwtService).sign({ sub: userId, role: 'client' });
  }

  it('join : table valide → room table:<id> rejointe (ack ok)', async () => {
    const client = await connectClient();
    const ack = await join(client, { tableId: TABLE_ID });
    expect(ack).toEqual({ ok: true, tableId: TABLE_ID });

    const received: any[] = [];
    client.on('message:new', (payload: any) => received.push(payload));
    realtime.emitMessageNew(TABLE_ID, { _id: 'm1', content: 'Salut' });
    await waitFor(() => received.length > 0);
    expect(received[0].message.content).toBe('Salut');
    client.disconnect();
  });

  it('join : tableId invalide → ack erreur + événement join:error', async () => {
    const client = await connectClient();
    const joinError = new Promise<any>((resolve) => client.once('join:error', resolve));
    const ack = await join(client, { tableId: 'not-a-mongoid' });
    expect(ack.ok).toBe(false);
    expect(await joinError).toEqual({ tableId: 'not-a-mongoid' });
    client.disconnect();
  });

  it('join : table inexistante → ack erreur', async () => {
    const client = await connectClient();
    const ack = await join(client, { tableId: new Types.ObjectId().toString() });
    expect(ack.ok).toBe(false);
    client.disconnect();
  });

  it('join : table désactivée → ack erreur (join:error)', async () => {
    const client = await connectClient();
    const joinError = new Promise<any>((resolve) => client.once('join:error', resolve));
    const ack = await join(client, { tableId: OTHER_TABLE_ID });
    expect(ack.ok).toBe(false);
    expect(ack.error).toBeDefined();
    expect(await joinError).toEqual({ tableId: OTHER_TABLE_ID });
    client.disconnect();
  });

  it('2 clients dans la même room table reçoivent message:new ; le client hors room non', async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();
    const clientC = await connectClient();

    await Promise.all([
      join(clientA, { tableId: TABLE_ID }),
      join(clientB, { tableId: TABLE_ID }),
      join(clientC, { tableId: OTHER_TABLE_ID }), // inactive → pas dans la room de A/B
    ]);

    const receivedA: any[] = [];
    const receivedB: any[] = [];
    const receivedC: any[] = [];
    clientA.on('message:new', (payload: any) => receivedA.push(payload));
    clientB.on('message:new', (payload: any) => receivedB.push(payload));
    clientC.on('message:new', (payload: any) => receivedC.push(payload));

    realtime.emitMessageNew(TABLE_ID, { _id: 'm2', content: 'On commande quoi ?' });
    await waitFor(() => receivedA.length > 0 && receivedB.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    expect(receivedC).toHaveLength(0);
    clientA.disconnect();
    clientB.disconnect();
    clientC.disconnect();
  });

  it('message privé : reçu par sender + destinataire (rooms avatar), JAMAIS par un tiers de la room table', async () => {
    // Flux légitime : les avatars sont associés à des sockets AUTHENTIFIÉS
    // (userId du token = userId de l'avatar). clientC reste anonyme (room
    // table seule — les privés d'autrui ne le concernent pas).
    const clientA = await connectClientWithToken(tokenFor(OWNER_USER_ID));
    const clientB = await connectClientWithToken(tokenFor(OTHER_USER_ID));
    const clientC = await connectClient();

    await Promise.all([
      join(clientA, { tableId: TABLE_ID, avatarId: AVATAR_A_ID }),
      join(clientB, { tableId: TABLE_ID, avatarId: AVATAR_B_ID }),
      join(clientC, { tableId: TABLE_ID }),
    ]);

    const receivedA: any[] = [];
    const receivedB: any[] = [];
    const receivedC: any[] = [];
    clientA.on('message:new', (payload: any) => receivedA.push(payload));
    clientB.on('message:new', (payload: any) => receivedB.push(payload));
    clientC.on('message:new', (payload: any) => receivedC.push(payload));

    // Message privé B → A.
    realtime.emitMessageNew(TABLE_ID, {
      _id: 'm3',
      fromAvatarId: AVATAR_B_ID,
      toAvatarId: AVATAR_A_ID,
      content: 'Salut toi',
    });
    await waitFor(() => receivedA.length > 0 && receivedB.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    expect(receivedC).toHaveLength(0); // le privé d'autrui ne fuit pas dans la room table
    clientA.disconnect();
    clientB.disconnect();
    clientC.disconnect();
  });

  it('avatar:joined / avatar:left émis dans la room table', async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();
    await Promise.all([join(clientA, { tableId: TABLE_ID }), join(clientB, { tableId: TABLE_ID })]);

    const joined: any[] = [];
    const left: any[] = [];
    clientA.on('avatar:joined', (payload: any) => joined.push(payload));
    clientB.on('avatar:left', (payload: any) => left.push(payload));

    realtime.emitAvatarJoined(TABLE_ID, { _id: 'av1', pseudo: 'Jean237' });
    realtime.emitAvatarLeft(TABLE_ID, 'av1');
    await waitFor(() => joined.length > 0 && left.length > 0);
    expect(joined[0].avatar.pseudo).toBe('Jean237');
    expect(left[0].avatarId).toBe('av1');
    clientA.disconnect();
    clientB.disconnect();
  });

  it('disconnect du socket possédant un avatar VALIDÉ → avatar:left émis dans la room table', async () => {
    // Association avatar légitime : socket authentifié propriétaire de l'avatar.
    const clientA = await connectClientWithToken(tokenFor(OWNER_USER_ID));
    const clientB = await connectClient();
    await Promise.all([
      join(clientA, { tableId: TABLE_ID, avatarId: AVATAR_A_ID }),
      join(clientB, { tableId: TABLE_ID }),
    ]);

    const left: any[] = [];
    clientB.on('avatar:left', (payload: any) => left.push(payload));
    clientA.disconnect();
    await waitFor(() => left.length > 0);
    expect(left[0].avatarId).toBe(AVATAR_A_ID);
    clientB.disconnect();
  });

  it('m1 — join avec avatar hors de cette table → refusé (anti-spoof)', async () => {
    const client = await connectClient();
    const joinError = new Promise<any>((resolve) => client.once('join:error', resolve));
    const ack = await join(client, { tableId: TABLE_ID, avatarId: AVATAR_OTHER_TABLE_ID });
    expect(ack.ok).toBe(false);
    expect(ack.error).toBeDefined();
    expect(await joinError).toEqual({ tableId: TABLE_ID });
    client.disconnect();
  });

  it('m1 — join avec avatar d\'un autre utilisateur (token présent) → refusé', async () => {
    const client = await connectClientWithToken(tokenFor(OTHER_USER_ID));
    const ack = await join(client, { tableId: TABLE_ID, avatarId: AVATAR_A_ID }); // avatar de OWNER_USER_ID
    expect(ack.ok).toBe(false);
    client.disconnect();
  });

  it('m1 — join avec son propre avatar (token présent) → accepté', async () => {
    const client = await connectClientWithToken(tokenFor(OWNER_USER_ID));
    const ack = await join(client, { tableId: TABLE_ID, avatarId: AVATAR_A_ID });
    expect(ack.ok).toBe(true);
    client.disconnect();
  });

  it('m2 — join avec avatarId SANS token (socket anonyme) → refusé (anti-spoof strict)', async () => {
    // Un socket sans identité ne peut pas prouver la propriété de l'avatar :
    // il ne doit JAMAIS rejoindre la room avatar (sinon fuite des messages
    // privés d'autrui + avatar:left fantôme à sa déconnexion).
    const client = await connectClient();
    const ack = await join(client, { tableId: TABLE_ID, avatarId: AVATAR_A_ID });
    expect(ack.ok).toBe(false);
    client.disconnect();
  });

  it('m1 — disconnect après join refusé → PAS d\'avatar:left émis', async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();
    await Promise.all([
      join(clientA, { tableId: TABLE_ID, avatarId: AVATAR_OTHER_TABLE_ID }), // refusé
      join(clientB, { tableId: TABLE_ID }),
    ]);
    const left: any[] = [];
    clientB.on('avatar:left', (payload: any) => left.push(payload));
    clientA.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(left).toHaveLength(0);
    clientB.disconnect();
  });

  it('table:removed : reçu par tous les clients de la room table', async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();
    const clientC = await connectClient();
    await Promise.all([
      join(clientA, { tableId: TABLE_ID }),
      join(clientB, { tableId: TABLE_ID }),
      join(clientC, { tableId: OTHER_TABLE_ID }), // room différente
    ]);

    const receivedA: any[] = [];
    const receivedB: any[] = [];
    const receivedC: any[] = [];
    clientA.on('table:removed', (payload: any) => receivedA.push(payload));
    clientB.on('table:removed', (payload: any) => receivedB.push(payload));
    clientC.on('table:removed', (payload: any) => receivedC.push(payload));

    realtime.emitTableRemoved(TABLE_ID);
    await waitFor(() => receivedA.length > 0 && receivedB.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(receivedA[0]).toEqual({ tableId: TABLE_ID });
    expect(receivedB[0]).toEqual({ tableId: TABLE_ID });
    expect(receivedC).toHaveLength(0);
    clientA.disconnect();
    clientB.disconnect();
    clientC.disconnect();
  });

  it('handshake avec token JWT invalide : connexion acceptée (JWT optionnel)', async () => {
    const client = await connectClientWithToken('invalid-token');
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('preflight OPTIONS sur une autre route : toujours 204 (middleware maison intact)', async () => {
    const res = await fetch(`http://localhost:${port}/api/chat/positions`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:4200', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.status).toBe(204);
  });
});
