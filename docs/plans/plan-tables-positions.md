# Plan : Tables à deux niveaux + positions (sièges) — yChat par table

> Statut : plan à implémenter. Basé sur l'état réel du code (backend `eat-app-backend` 418 tests verts, frontend `eat-app` 225 tests verts, phases 1-2 non commitées / jamais déployées → refactor libre, **aucune migration de données**).

## 1. Contexte (ground truth vérifié)

### Backend — `/Users/flambel/Documents/GitHub/eat-app-backend`
- `src/database/schemas/table-position.schema.ts` : `TablePosition = { restaurantId, idQr (unique 12 chars base64url), label, isActive }`. **Pas de tableId.**
- `src/database/schemas/chat-user.schema.ts` : `ChatUser = { restaurantId, positionId (required), pseudo, sex, photoUrl, status, socialUrls, isVerified, isPersistant, userId, expiresAt (TTL 12h, absent si persistant) }`. **Pas de tableId.**
- `src/database/schemas/chat-message.schema.ts` : `ChatMessage = { restaurantId, positionId (required), fromAvatarId, toAvatarId (null = groupe), content, expiresAt (TTL 10h) }`. Index `{ positionId: 1, createdAt: -1 }`, TTL `{ expiresAt: 1 }`.
- `src/modules/chat/chat.controller.ts` : `POST /chat/positions` (ADMIN/MANAGER), `GET /chat/positions` (ADMIN/MANAGER/EMPLOYEE), `PATCH /chat/positions/:id` (ADMIN/MANAGER), `GET /chat/positions/:id/qr` (ADMIN/MANAGER), `GET /chat/positions/by-qr/:idQr` (session, déclarée avant les routes `:id`), `POST /chat/avatars`, `GET /chat/avatars?positionId=`, `DELETE /chat/avatars/:id`, `POST /chat/messages`, `GET /chat/messages?positionId=&avatarId=`.
- `src/modules/chat/chat.service.ts` : `createPosition` (manager forcé à son restaurantId, admin `dto.restaurantId` requis ; idQr = `randomBytes(9).toString('base64url')` + retry collision → `ConflictException`), `listPositions` (scoping), `updatePosition`, `positionQr` (URL = `${FRONTEND_URL}/restaurant/yChat?idQr=...`, `qrcode.toDataURL`), `findPositionByQr` (`findOne({ idQr, isActive: true })` → `{ position, restaurantId }` ou 404), `findPositionById`, avatars (`createAvatar`, `listAvatars` filtre TTL/persistant, `deleteAvatar` cascade messages + emitAvatarLeft), messages (`createMessage` validation positionId cohérente avec avatar, TTL 10h ; `listMessages` perspective actor : groupe + privés), cron `purgeExpired` */10min avec `CronLeaseService` lease `chat.purge`.
- `src/modules/chat/chat.gateway.ts` : rooms `position:<positionId>` (groupe) et `position:<positionId>:avatar:<avatarId>` (privé) ; `join { positionId, avatarId? }` avec validation position existe + `validateAvatarAssociation` (existe, `avatar.positionId === positionId`, propriété userId) ; disconnect émet `avatar:left` si join validé ; events `message:new`, `avatar:joined`, `avatar:left`, `avatar:updated`, `join:error`.
- `src/modules/chat/chat-realtime.service.ts` : wrapper d'émissions.
- Tests : `chat.service.spec.ts`, `chat.controller.int.spec.ts` (supertest), `chat.gateway.spec.ts` (socket.io-client réel).
- `src/modules/chat/chat.module.ts` : enregistre TablePosition, ChatUser, ChatMessage ; exporte ChatService + ChatRealtimeService.
- DTOs : `CreateTablePositionDto { label (1..100), restaurantId? }`, `UpdateTablePositionDto { label?, isActive? }`, `CreateChatAvatarDto { positionId, pseudo, sex, photoUrl, ... }`, `CreateChatMessageDto { positionId, fromAvatarId, toAvatarId?, content (1..1000) }`.

### Frontend — `/Users/flambel/Documents/GitHub/eat-app`
- Route `/admin/restaurants/:id` → `AdminRestaurantDetailComponent` (`src/app/features/admin/admin-restaurant-detail/`). Garde admin au niveau `/admin`. Pattern : `page-header` + `hero` + sections `detail-section`, load via `adminService.getRestaurantById`, sous-loads (balance, employees), modals (`staffModal`, `balanceModal`), `appConfirmAction` pour suppressions.
- `src/app/features/ops-shared/chat-positions/` : `ChatPositionsComponent` (selector `app-chat-positions`), `@Input restaurantId` + fallback query param, getter `canManage` (admin/manager), liste positions (label, idQr, badge statut, actions QR + activer/désactiver), création ngModel, panneau QR modal (img dataUrl + url + print area + `window.print()`).
- `src/app/core/services/chat.service.ts` : `listPositions`, `createPosition`, `updatePosition`, `getPositionQr`, `getPositionByQr` → GET/POST/PATCH `/chat/positions...`.
- Routes : admin `chat-positions` (admin-routing:69), manager `chat-positions` (manager-routing:35, roles manager/employee).
- `src/app/features/ychat/` : `ychat.resolver` (idQr query param → localStorage `food_ychat_qr` → GET by-qr → `{ position._id, position.isActive, restaurantId }`), `ychat-page` (positionId = `data.position._id`, commander → `/restaurant/table/commande/:restaurantId`), `ychat.service` (`connect(positionId, avatarId)`, `join { positionId, avatarId }`, cache `food_ychat_msgs_<positionId>` TTL 10h, `food_ychat_avatar_<userId>_<positionId>`, GET `/chat/messages?positionId=`, GET `/chat/avatars?positionId=`).
- Karma/Jasmine, NgModules, SCSS custom + ngx-toastr (pas d'Angular Material).

### Conventions à respecter
- Guards : `JwtAuthGuard` + `RolesGuard` + `@Roles(UserRole...)`.
- DTOs class-validator + `@ApiProperty`/`@ApiPropertyOptional`.
- Pagination : `normalizePagination` / `buildPaginationMeta`.
- `auditLogs.record` pour actions sensibles.
- Timezone : Africa/Douala.

---

## 2. Vue d'ensemble et ordre des tâches

Modèle cible : **Table (ex. « Table 3 ») → plusieurs Positions (sièges, chacune avec son idQr unique)**. Le chat de groupe yChat est partagé **par table** (room `table:<tableId>`), les messages privés par couple d'avatars dans la room `table:<tableId>:avatar:<avatarId>`.

Ordre :
1. **Backend d'abord** (T1 → T6) : schémas → module tables → refactor chat → gateway → cron → nettoyage endpoints.
2. **Contrats figés** à la fin de T6 : c'est le point de synchronisation (API REST + events socket).
3. **Frontend ensuite** (T7 → T12) : services/models → composants partagés → admin → manager → yChat → tests. T8-T10 peuvent être parallélisées entre deux devs une fois T7 posée ; T11 (yChat) dépend de T7 seulement.

---

## 3. Schémas Mongoose proposés

### `src/database/schemas/table.schema.ts` (NOUVEAU)
```ts
export class Table {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId;
  /** Label libre (ex. « Table 3 », « Terrasse 1 »). PAS d'unicité imposée — voir décision D1. */
  @Prop({ required: true, minlength: 1, maxlength: 100 }) label: string;
  @Prop({ default: true }) isActive: boolean;
  // timestamps: true
}
export const TableSchema = SchemaFactory.createForClass(Table);
TableSchema.index({ restaurantId: 1, isActive: 1 });
```
**Décision D1 (à documenter dans le code) :** pas d'unicité stricte sur `label` au sein d'un restaurant. Justification : les labels sont de la saisie humaine (« Table 3 » peut exister en salle + terrasse) ; imposer l'unicité créerait des erreurs frustrantes sans valeur métier (le QR est par position, pas par label). La déduplication visuelle est laissée à l'utilisateur. Un index non-unique `{ restaurantId: 1, isActive: 1 }` sert au scoping des listes.

### `src/database/schemas/table-position.schema.ts` (MODIFIÉ)
```ts
export class TablePosition {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId; // inchangé (déjà présent, dénormalisé)
  @Prop({ type: Types.ObjectId, ref: 'Table', required: true }) tableId: Types.ObjectId;           // NOUVEAU required
  @Prop({ unique: true }) idQr: string;                                                            // inchangé
  /** Optionnel : « Siège 1 » par défaut — voir décision D2. */
  @Prop({ maxlength: 100 }) label?: string;                                                        // passe en optionnel
  @Prop({ default: true }) isActive: boolean;
}
TablePositionSchema.index({ tableId: 1, isActive: 1 });
TablePositionSchema.index({ restaurantId: 1, isActive: 1 }); // conservé si déjà présent
```
**Décision D2 :** `label` de la position devient **optionnel** ; si vide/absent à la création, le backend auto-génère « Siège N » où N = `(nombre de positions de la table) + 1` (compteur calculé à la création, sans contrainte d'unicité dure — un simple `countDocuments({ tableId })` suffit, la collision de label étant sans conséquence). Un label de siège est utile à l'admin pour distinguer les QR imprimés. Le DTO d'update autorise toujours le renommage.

### `src/database/schemas/chat-user.schema.ts` (MODIFIÉ)
```ts
@Prop({ type: Types.ObjectId, ref: 'TablePosition', required: true }) positionId: Types.ObjectId; // inchangé
@Prop({ type: Types.ObjectId, ref: 'Table', required: true }) tableId: Types.ObjectId;            // NOUVEAU — dénormalisé depuis la position à la création
```

### `src/database/schemas/chat-message.schema.ts` (MODIFIÉ — breaking)
```ts
// positionId SUPPRIMÉ, remplacé par :
@Prop({ type: Types.ObjectId, ref: 'Table', required: true }) tableId: Types.ObjectId;
// fromAvatarId / toAvatarId / content / expiresAt inchangés
ChatMessageSchema.index({ tableId: 1, createdAt: -1 });   // remplace { positionId: 1, createdAt: -1 }
ChatMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // inchangé
```
Rattachement : messages de groupe (`toAvatarId: null`) **et** privés (`toAvatarId` set) appartiennent à la table.

---

## 4. Contrats API (nouveau module `tables`) + refactor chat

### Module `src/modules/tables/` (NOUVEAU)

| Méthode | Path | Rôles | DTO | Réponse |
|---|---|---|---|---|
| POST | `/tables` | ADMIN, MANAGER | `CreateTableDto { label (1..100), restaurantId? (admin requis, manager ignoré/forcé) }` | 201 `Table` |
| GET | `/tables?restaurantId=&page=&limit=` | ADMIN, MANAGER, EMPLOYEE | — | 200 `PaginatedResponse<Table>` (scoping : manager/employee → leur restaurant) |
| PATCH | `/tables/:id` | ADMIN, MANAGER | `UpdateTableDto { label?, isActive? }` | 200 `Table` (404 si pas dans le scope) |
| DELETE | `/tables/:id` | ADMIN, MANAGER | — | 200 `{ deleted: true }` — **CASCADE** : positions de la table → avatars de chaque position → messages de la table (groupe + privés). Émet `table:removed` à la room `table:<id>` |
| POST | `/tables/:tableId/positions` | ADMIN, MANAGER | `CreateTablePositionDto { label? (auto « Siège N » si vide), restaurantId? (ignoré — dérivé de la table) }` | 201 `TablePosition` (404 si table hors scope / inexistante) |
| GET | `/tables/:tableId/positions?page=&limit=` | ADMIN, MANAGER, EMPLOYEE | — | 200 `PaginatedResponse<TablePosition>` (scoping via la table) |
| PATCH | `/tables/:tableId/positions/:id` | ADMIN, MANAGER | `UpdateTablePositionDto { label?, isActive? }` | 200 `TablePosition` (404 si position ∉ table ou table hors scope) |
| DELETE | `/tables/:tableId/positions/:id` | ADMIN, MANAGER | — | 200 `{ deleted: true }` — **CASCADE** : avatars de la position → leurs messages (fromAvatarId ou toAvatarId ∈ avatars). Émet `avatar:left` pour chaque avatar supprimé. Les autres positions de la table continuent le chat de groupe |
| GET | `/tables/:tableId/positions/:id/qr` | ADMIN, MANAGER | — | 200 `{ dataUrl, url }` (URL inchangée : `${FRONTEND_URL}/restaurant/yChat?idQr=...`) |

**Règles de scoping (identiques à chat.service actuel) :** ADMIN voit tout (`restaurantId` query optionnel sur la liste) ; MANAGER/EMPLOYEE forcés à `actor.restaurantId` (403/404 si mismatch). Manager sans restaurantId → `ForbiddenException`.

**Endpoints supprimés de `chat.controller` :** `POST /chat/positions`, `GET /chat/positions`, `PATCH /chat/positions/:id`, `GET /chat/positions/:id/qr`. **Conservé :** `GET /chat/positions/by-qr/:idQr` (renommé logiquement « résolution QR yChat »).

### Module chat (refactor)

| Endpoint | Changement |
|---|---|
| `GET /chat/positions/by-qr/:idQr` | Réponse : `{ position, tableId, restaurantId }` (position = siège). Toujours `isActive: true` exigé, 404 sinon. Session requise (inchangé) |
| `POST /chat/avatars` | DTO inchangé (`positionId` requis = siège scanné). Le service dérive `tableId` depuis la position (404 si position inexistante/inactive) et stocke `positionId` + `tableId` |
| `GET /chat/avatars?tableId=` | **`positionId` → `tableId`** : avatars non expirés de toute la table (toutes positions) |
| `DELETE /chat/avatars/:id` | Inchangé (cascade messages + `avatar:left`), mais room = `table:<tableId>` |
| `POST /chat/messages` | DTO : `positionId` → **`tableId`**. Validation : `avatar.tableId === dto.tableId` (400 sinon), avatar appartient à l'actor, `toAvatarId` (si set) appartient à la même table. TTL 10h inchangé |
| `GET /chat/messages?tableId=&avatarId=` | **`positionId` → `tableId`** : groupe (`toAvatarId: null`) + privés de la perspective de l'actor (inchangé, mais sur tableId) |

### Contrats socket (gateway)

| Élément | Valeur |
|---|---|
| Room groupe | `table:<tableId>` |
| Room privé | `table:<tableId>:avatar:<avatarId>` |
| Handshake join | `{ tableId, avatarId? }` — validation : table existe + `isActive`, avatar existe + `avatar.tableId === tableId` + propriété `userId`. Sinon `join:error` |
| Events conservés | `message:new`, `avatar:joined`, `avatar:left`, `avatar:updated`, `join:error` (payloads inchangés, rooms renommées) |
| **Event NOUVEAU** | `table:removed` `{ tableId }` — émis à la room `table:<tableId>` lors du DELETE /tables/:id. Les clients yChat écoutent cet event → notification + déconnexion + redirection |

---

## 5. Tâches numérotées

### Backend

#### T1 — Schémas : Table + TablePosition.tableId + ChatUser.tableId + ChatMessage.tableId
- **Fichiers :**
  - CRÉER `src/database/schemas/table.schema.ts` (cf. §3).
  - MODIFIER `src/database/schemas/table-position.schema.ts` : ajouter `tableId` (ref Table, required), `label` → optionnel, index `{ tableId: 1, isActive: 1 }`.
  - MODIFIER `src/database/schemas/chat-user.schema.ts` : ajouter `tableId` (ref Table, required).
  - MODIFIER `src/database/schemas/chat-message.schema.ts` : `positionId` → `tableId`, index `{ tableId: 1, createdAt: -1 }`.
- **Contenu :** classes + indexes exacts du §3, commentaires documentant D1/D2.
- **Critères de test :** compilation OK ; specs de schémas légers si le pattern existe (sinon couvert par T2/T5).
- **Dépend :** rien. ⚠️ Casse la compilation de chat.service (normal, résolu en T3).

#### T2 — Module tables : service + controller + DTOs + enregistrement
- **Fichiers :**
  - CRÉER `src/modules/tables/tables.module.ts` (MongooseModule.forFeature : Table, TablePosition, ChatUser, ChatMessage ; importe ChatRealtimeService depuis ChatModule pour les émissions socket — ou injecte directement le gateway selon le pattern existant dans chat.service).
  - CRÉER `src/modules/tables/tables.service.ts` : `createTable` (manager forcé à son restaurantId, admin `dto.restaurantId` requis), `listTables` (scoping + pagination), `updateTable` (scoping, 404 sinon), `deleteTable` (cascade, cf. §7), `createPosition` (tableId du path, scoping : la table doit appartenir au restaurant de l'actor ; label auto « Siège N » via `countDocuments({ tableId }) + 1` si vide ; idQr = `randomBytes(9).toString('base64url')` + retry collision → `ConflictException`), `listPositions` (scoping via table), `updatePosition` (position ∈ table + scoping), `deletePosition` (cascade, cf. §7), `positionQr` (copie exacte de `positionQr` de chat.service : `${FRONTEND_URL}/restaurant/yChat?idQr=...`, `qrcode.toDataURL`).
  - CRÉER `src/modules/tables/tables.controller.ts` : routes du §4, guards `JwtAuthGuard` + `RolesGuard` + `@Roles`, `@ApiBearerAuth`/`@ApiOperation`/`@ApiParam`/`@ApiQuery`/`@ApiOkResponse` (pattern exact de chat.controller). **Ordre des routes :** `/:tableId/positions/:id/qr` avant tout pattern `:id` ambigu ; pas de route by-qr ici (elle reste dans chat).
  - CRÉER `src/modules/tables/dto/create-table.dto.ts`, `update-table.dto.ts`, `create-table-position.dto.ts` (déplacer depuis chat/dto et adapter : `label` optionnel), `update-table-position.dto.ts` (déplacer).
  - MODIFIER `src/app.module.ts` (ou le fichier d'enregistrement des modules) : importer `TablesModule` après `ChatModule`.
- **Critères de test :** `tables.service.spec.ts` — CRUD, scoping (manager forcé, admin libre, employee lecture), label auto « Siège N », collision idQr → 409, QR URL/dataUrl. `tables.controller.int.spec.ts` (supertest) — rôles 403, DTOs 400, scoping 404.
- **Dépend :** T1.

#### T3 — Refactor chat.service : avatars/messages par table + by-qr
- **Fichiers :**
  - MODIFIER `src/modules/chat/chat.service.ts` :
    - **SUPPRIMER** `createPosition`, `listPositions`, `updatePosition`, `positionQr` (migrés en T2) ; retirer les imports DTO positions et (selon usage) le modèle TablePosition — le garder si `findPositionByQr`/`createAvatar` en ont besoin (oui : les deux).
    - `findPositionByQr(idQr)` : retourne `{ position, tableId, restaurantId }` (404 si inexistant/inactif).
    - `createAvatar` : après résolution de la position (`findPositionById`, `isActive` exigé), dénormalise `tableId = position.tableId` dans le ChatUser.
    - `listAvatars(actor, tableId, ...)` : filtre `{ tableId, ... }` (TTL + persistant inchangés). Décision : validation légère que la table existe (404) — pas de scoping par rôle (c'est un endpoint session yChat).
    - `createMessage` : `dto.tableId` requis ; validation `avatar.tableId === dto.tableId` (400), `toAvatarId` même table (400), TTL 10h inchangé.
    - `listMessages` : sur `tableId` — requête groupe + privés perspective actor (même logique, champ renommé).
    - `deleteAvatar` : cascade inchangée mais émissions sur room `table:<tableId>`.
  - MODIFIER `src/modules/chat/dto/create-chat-message.dto.ts` : `positionId` → `tableId`.
  - MODIFIER `src/modules/chat/dto/create-chat-avatar.dto.ts` : doc du `positionId` (« siège scanné ; tableId dérivé côté backend »).
  - MODIFIER `src/modules/chat/chat.module.ts` : enregistrer le modèle `Table` (nécessaire pour `findPositionByQr`/createAvatar) ; exporter ChatRealtimeService pour TablesModule.
- **Critères de test :** `chat.service.spec.ts` mis à jour — by-qr renvoie tableId ; createAvatar stocke tableId + 404 position inactive ; createMessage 400 si tableId ≠ avatar.tableId ; listMessages par tableId (groupe + privés) ; listAvatars par tableId.
- **Dépend :** T1, T2 (pour l'ordre de migration propre).

#### T4 — Gateway : rooms par table + event `table:removed`
- **Fichiers :**
  - MODIFIER `src/modules/chat/chat.gateway.ts` : rooms `table:<tableId>` / `table:<tableId>:avatar:<avatarId>` ; handler `join { tableId, avatarId? }` — validation : table existe + active (nouveau besoin : injecter le modèle Table ou passer par ChatService), `validateAvatarAssociation` adapté (`avatar.tableId === tableId`) ; disconnect → `avatar:left` si join validé.
  - MODIFIER `src/modules/chat/chat-realtime.service.ts` : méthodes d'émission sur les nouvelles rooms + **`emitTableRemoved(tableId)`** → `io.to('table:' + tableId).emit('table:removed', { tableId })`.
- **Critères de test :** `chat.gateway.spec.ts` (socket.io-client réel) — join room table OK, `join:error` si table inactive / avatar hors table, message:new diffusé à la room table, privé isolé, `table:removed` reçu par tous les clients de la room.
- **Dépend :** T1, T3.

#### T5 — Cron purge : avatars orphelins + messages
- **Fichiers :** MODIFIER `src/modules/chat/chat.service.ts` (cron `purgeExpired`, lease `chat.purge` inchangé) :
  - Purger les avatars expirés (TTL 12h) — inchangé.
  - **NOUVEAU :** purger les avatars dont la position a été supprimée (orphelins) : `avatarModel.find({ positionId: { $nin: [ids positions existantes] } })` — implémentation simple : pour chaque avatar orphelin détecté (batch), supprimer ses messages + émettre `avatar:left`. Filet de sécurité (la cascade T2 devrait déjà tout supprimer ; le cron couvre les cas d'échec partiel ou les courses).
  - Purge messages TTL 10h — inchangé.
- **Critères de test :** `chat.service.spec.ts` — cron supprime avatar orphelin + ses messages ; avatars/messages valides intacts.
- **Dépend :** T1, T3.

#### T6 — Nettoyage : supprimer les endpoints positions du chat.controller
- **Fichiers :**
  - MODIFIER `src/modules/chat/chat.controller.ts` : supprimer `POST /chat/positions`, `GET /chat/positions`, `PATCH /chat/positions/:id`, `GET /chat/positions/:id/qr`. **Conserver `GET /chat/positions/by-qr/:idQr`** (déclarée avant les routes `:id` — reste la seule route `positions` du chat, donc pas de conflit), mettre à jour son `@ApiOperation` : `{ position, tableId, restaurantId }`.
  - MODIFIER `src/modules/chat/chat.controller.int.spec.ts` : retirer les specs des endpoints supprimés, mettre à jour by-qr.
- **Critères de test :** suite backend entière verte ; grep « /chat/positions » ne retourne plus que by-qr.
- **Dépend :** T2, T3, T4, T5.

### Frontend

#### T7 — Models + service `tables` (contrats figés)
- **Fichiers :**
  - MODIFIER `src/app/core/models/ychat.model.ts` : `ChatPosition` + `tableId?: string` ; nouveau `Table { _id, restaurantId, label, isActive, createdAt, updatedAt }` ; `ChatPositionByQrResponse` + `tableId: string`.
  - CRÉER `src/app/core/services/tables.service.ts` : `listTables(restaurantId?)`, `createTable(label, restaurantId?)`, `updateTable(id, patch)`, `deleteTable(id)`, `listPositions(tableId)`, `createPosition(tableId, label?)`, `updatePosition(tableId, positionId, patch)`, `deletePosition(tableId, positionId)`, `getPositionQr(tableId, positionId)` → paths du §4.
  - MODIFIER `src/app/core/services/chat.service.ts` : **supprimer** les méthodes positions (migrées), garder `getPositionByQr` (yChat). Mettre à jour le doc-comment.
- **Critères de test :** spec du service tables (HttpTestingController) : paths, query params, bodies.
- **Dépend :** contrats T6 (lecteur seulement).

#### T8 — Composants partagés `ops-shared/tables/`
- **Fichiers :**
  - CRÉER `src/app/features/ops-shared/tables/tables-list.component.{ts,html,scss,spec.ts}` : selector `app-tables-list`, `@Input() restaurantId`, `@Input() canManage` ; liste tables (label, **nombre de positions** — ajouter `positionCount` à la réponse backend ? **Décision : non** — compter côté composant via un GET positions par table serait N+1 ; option retenue : afficher sans count en v1, ou enrichir `GET /tables` avec un `$lookup`/`countDocuments` groupé côté backend → **voir T2bis**), badge actif/inactif, actions : ouvrir (emit `open(table)`), éditer label, activer/désactiver, supprimer avec `appConfirmAction` (toastr ngx-toastr).
  - CRÉER `src/app/features/ops-shared/tables/table-positions.component.{ts,html,scss,spec.ts}` : selector `app-table-positions`, `@Input() restaurantId`, `@Input() tableId`, `@Input() canManage` ; **réutiliser le pattern existant de `ChatPositionsComponent`** (liste label + idQr + badge statut + actions QR/éditer/activer-désactiver/supprimer, création ngModel, panneau QR modal img dataUrl + url + print area + `window.print()`). Copier/scss depuis `ops-shared/chat-positions/` puis supprimer l'ancien composant en T10.
  - MODIFIER `src/app/features/ops-shared/ops-shared.module.ts` (ou le module qui déclare `app-chat-positions`) : déclarer les nouveaux composants.
- **Critères de test :** specs Karma — rendu liste, création, toggle, suppression (confirm), panneau QR (contenu img + url), a11y (role="dialog", aria-label, focus).
- **Dépend :** T7. ⚠️ T2bis (backend) si le count de positions est voulu dès v1.

#### T9 — Admin : section « Tables » + route imbriquée
- **Fichiers :**
  - MODIFIER `src/app/features/admin/admin-restaurant-detail/admin-restaurant-detail.component.{ts,html,scss}` : nouvelle section `detail-section` « Tables » avec `<app-tables-list [restaurantId]="id" [canManage]="true">` (pattern des sections existantes : hero + section, load parallèle).
  - MODIFIER `src/app/features/admin/admin-routing.module.ts` (admin-routing, ~ligne 69) : route enfant imbriquée `tables/:tableId` → `TablePositionsComponent` (via `app-table-positions` wrapper ou composant direct). **Décision :** route imbriquée sous `restaurants/:id` → `restaurants/:id/tables/:tableId` ; le composant reçoit `restaurantId` + `tableId` du snapshot, bouton retour vers le détail restaurant.
  - CRÉER `src/app/features/admin/admin-restaurant-tables/admin-restaurant-table-positions.component.{ts,html,spec.ts}` (wrapper léger autour de `app-table-positions` si nécessaire pour le breadcrumb/retour) — ou déclarer directement `TablePositionsComponent` dans la route si le composant partagé suffit.
- **Critères de test :** spec admin-restaurant-detail (section rendue, interations) ; spec routing (navigation imbriquée).
- **Dépend :** T8.

#### T10 — Page manager : chat-positions → tables
- **Fichiers :**
  - MODIFIER `src/app/features/manager/…` (page manager existante qui rend `app-chat-positions` — la repérer via grep `app-chat-positions`) : remplacer par liste tables + navigation vers positions de table (route manager `tables/:tableId`, roles manager/employee, même composant partagé).
  - MODIFIER `src/app/features/manager/manager-routing.module.ts` (ligne ~35) : `chat-positions` → `tables` + `tables/:tableId`.
  - SUPPRIMER `src/app/features/ops-shared/chat-positions/` (composant + spec) une fois plus référencé.
- **Critères de test :** specs manager adaptées ; grep `app-chat-positions` vide ; `ng build` OK.
- **Dépend :** T8, T9 (indépendant de T9 en réalité — peut être parallèle).

#### T11 — yChat adapté au modèle table
- **Fichiers :**
  - MODIFIER `src/app/features/ychat/ychat.resolver.ts` : `YChatData` + `tableId` ; résolution via `getPositionByQr` → `{ position, tableId, restaurantId }` ; validation `position.isActive` inchangée ; **passer `tableId` à YChatService**.
  - MODIFIER `src/app/core/services/ychat.service.ts` : `connect(tableId, avatarId)`, `join { tableId, avatarId }`, caches `food_ychat_msgs_<tableId>` (TTL 10h) + `food_ychat_avatar_<userId>_<tableId>`, GET `/chat/messages?tableId=`, GET `/chat/avatars?tableId=`, **listener `table:removed`** → subject/notification → ychat-page déconnecte + toast + redirect `/`.
  - MODIFIER `src/app/features/ychat/ychat-page.component.{ts,html}` : utiliser `tableId` partout ; avatar créé via `POST /chat/avatars` avec `positionId` (le siège scanné — backend dérive tableId) ; la barre « Ma table » liste les avatars de la table (toutes positions) via `GET /chat/avatars?tableId=` ; handler `table:removed` → notification + déconnexion + redirection `/`.
  - MODIFIER `src/app/features/ychat/table-chat/`, `user-list/`, `chat-header/`, `floating-menu/` : renommage positionId → tableId dans les bindings/émissions.
- **Critères de test :** specs resolver (tableId résolu), ychat.service (caches par tableId, join payload, table:removed), ychat-page (avatar par positionId, barre « Ma table » = avatars de table, redirect sur table:removed).
- **Dépend :** T7 ; backend T3/T4 pour l'intégration réelle.

#### T12 — Tests frontend finaux + vérif globale
- **Fichiers :** specs de T7-T11 complétées ; adaptation des specs ychat existantes (`ychat-page.component.spec.ts`, `table-chat.component.spec.ts`, `user-list.component.spec.ts`, `chat-header.component.spec.ts`, `avatar-modal.component.spec.ts`, `floating-menu.component.spec.ts`, `ychat.resolver.spec.ts`).
- **Critères de test :** `ng test` vert (≥ ancien niveau), `ng build` OK.
- **Dépend :** T7-T11.

---

## 6. Plan de tests (récapitulatif par tâche)

| Tâche | Tests |
|---|---|
| T1 | Compilation ; couvert par T2/T3/T5 |
| T2 | `tables.service.spec.ts` (CRUD, scoping, label auto « Siège N », collision idQr → 409, QR) ; `tables.controller.int.spec.ts` (supertest : rôles, DTOs, scoping 404) |
| T3 | `chat.service.spec.ts` : by-qr → `{ position, tableId, restaurantId }` ; createAvatar dénormalise tableId (+404 inactive) ; createMessage 400 tableId mismatch ; listMessages/listAvatars par tableId ; deleteAvatar émissions |
| T4 | `chat.gateway.spec.ts` : rooms `table:<id>` / privé, `join:error` (table inactive, avatar hors table), `table:removed` reçu |
| T5 | cron : avatars orphelins + messages purgés, valides intacts |
| T6 | Suite backend verte ; grep endpoints supprimés |
| T7 | HttpTestingController : paths/params/bodies du service tables |
| T8 | Karma : rendu, création, toggle, suppression confirm, panneau QR, a11y dialog |
| T9 | Section admin rendue ; navigation imbriquée |
| T10 | Specs manager adaptées ; plus de référence à `app-chat-positions` |
| T11 | Resolver tableId, caches par tableId, join payload, barre « Ma table », redirect `table:removed` |
| T12 | `ng test` + `ng build` globaux |

---

## 7. Cascades (détail d'implémentation)

**DELETE position** (`/tables/:tableId/positions/:id`) :
1. Vérifier scoping + position ∈ table (404 sinon).
2. `avatars = ChatUser.find({ positionId })` (y compris persistants).
3. Pour chaque avatar : `ChatMessage.deleteMany({ $or: [{ fromAvatarId: a._id }, { toAvatarId: a._id }] })` (ses messages privés ET ses messages de groupe émis — les messages de groupe *reçus* de la table restent, ils appartiennent à la table).
4. `ChatUser.deleteMany({ positionId })`.
5. Émettre `avatar:left { avatarId }` à `table:<tableId>` pour chaque avatar supprimé.
6. Les **autres positions** de la table continuent le chat de groupe (les messages de groupe de la table sont intacts).

**DELETE table** (`/tables/:id`) :
1. Vérifier scoping (404 sinon).
2. `positions = TablePosition.find({ tableId })`.
3. `ChatUser.deleteMany({ tableId })` (avatars de toutes les positions).
4. `ChatMessage.deleteMany({ tableId })` (groupe + privés — tout le chat de la table disparaît).
5. `TablePosition.deleteMany({ tableId })`.
6. `Table.deleteOne()`.
7. Émettre `table:removed { tableId }` à `room table:<tableId>` (les clients yChat se déconnectent/redirigent d'eux-mêmes). Pas besoin d'`avatar:left` par avatar ici : la room est vidée par l'event unique.
8. `auditLogs.record` (action sensible — pattern existant).

---

## 8. Sécurité
- **Surfaces :** tous les endpoints tables sont sous `JwtAuthGuard` + `RolesGuard` + `@Roles` ; scoping restaurant obligatoire (manager/employee forcés à `actor.restaurantId`, admin explicite via DTO/query). Manager sans restaurant → `ForbiddenException` (pattern existant).
- **by-qr** : session requise, pas de rôle — conserver exactement (surface publique du scan).
- **Validation cohérence** : `avatar.tableId === dto.tableId` (messages) et `avatar.tableId === tableId` (gateway join) empêchent les fuites inter-tables. `toAvatarId` doit appartenir à la même table (privés).
- **Cascades** : idempotentes, sans exposant d'ID cross-restaurant (scoping vérifié avant toute suppression).
- **Audit** : `auditLogs.record` sur DELETE table / DELETE position (actions destructives) — aligner sur les conventions existantes.
- **idQr** : conservation du mécanisme `randomBytes(9).base64url` + retry collision.

## 9. Risques et points d'attention
1. **Casse de compilation en chaîne (T1)** — changer ChatMessage/ChatUser casse chat.service/gateway. *Mitigation :* ordre T1→T6 en une branche continue, suite jest après chaque tâche.
2. **Compatibilité by-qr avec le yChat existant** — le resolver actuel lit `res.position` ; ajouter `tableId` est additif mais `ychat.service` doit switcher sur tableId sinon le join gateway échouera (rooms renommées). *Mitigation :* T11 obligatoire, specs gateway/table en même temps que T4.
3. **Rooms socket renommées = breaking pour tout client connecté** — phases 1-2 non déployées, donc aucun client réel : risque nul en prod, mais les specs gateway doivent être réécrites avec les noms exacts (`table:<id>`), d'où le commentaire « contrat FIGÉ » dans chat.gateway.ts à mettre à jour.
4. **Cascades socket pendant les deletes** — émettre `avatar:left`/`table:removed` APRÈS suppression DB (pas de client reconnecté sur une room morte) ; vérifier l'ordre dans T2/T4.
5. **Label position auto-généré** — `countDocuments + 1` peut créer des doublons (« Siège 2 » après suppression d'une position) : acceptable (pas d'unicité), documenté dans D2.
6. **Nombre de positions affiché dans la liste tables** — risque N+1 si le composant interroge positions par table. *Mitigation :* option retenue par défaut : sans count en v1 ; si le client le veut, enrichir `GET /tables` avec un agrégat `$lookup`/`$facet` côté backend (T2bis, petite addition). À confirmer avec le client — garde simple par défaut.
7. **Impression de tous les QR d'une table** — optionnel, repoussé (garde simple : impression QR par position via le panneau existant).
8. **Regression tests backend** — `chat.controller.int.spec.ts` et `chat.gateway.spec.ts` sont fortement couplés au modèle actuel : réécriture substantielle prévue en T3-T6, ne pas les supprimer mais adapter.

## 10. Validation (commandes réelles du projet)

Backend (`/Users/flambel/Documents/GitHub/eat-app-backend`) :
```bash
npm run build        # nest build
npm test             # jest (418 tests actuels → tous verts après T6)
```

Frontend (`/Users/flambel/Documents/GitHub/eat-app`) :
```bash
npm run build        # ng build
npm test             # ng test (225 tests actuels → tous verts après T12)
```

*(Scripts vérifiés dans les `package.json` des deux projets ; pas de script lint dédié trouvé.)*
