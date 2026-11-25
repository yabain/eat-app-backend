# Plan : Commandes on-site (Phase 1) + yChat temps réel (Phase 2)

> Plan d'implémentation pour `eat-app` (frontend Angular 16) et `eat-app-backend` (NestJS 10).
> Généré à partir de l'état RÉEL du code (lignes/chemins cités). Aucun fichier modifié.

---

## 1. Vue d'ensemble des phases

| Phase | Livrable | Dépend envers |
|---|---|---|
| **Phase 1 — Commandes on-site** | `onSite`/`onDelivery` sur MenuItem, page staff `/restaurant/table/commande/:idRestaurant`, création commande `on_site` sans adresse/livreur, paiement DigiKuntz direct par le personnel | Backend + Frontend en parallèle, E2E à la fin |
| **Phase 2 — yChat** | Module chat backend (positions de table + QR, avatars, messages, TTL, cron cascade), gateway socket.io, feature frontend `/restaurant/yChat` | Dépend de la Phase 1 pour le bouton « Commander » → route Phase 1 |

**Ordre recommandé :** Phase 1 tasks T1→T12 (T1–T7 backend, T8–T11 frontend, T12 E2E) puis Phase 2 T13→T25.
Frontend et backend peuvent avancer en parallèle dès que les contrats API (section 5) sont figés.

---

## 2. Context Brief (ground truth)

**Backend** `/Users/flambel/Documents/GitHub/eat-app-backend` — NestJS 10, Mongoose 8, Jest 29 :
- `src/modules/orders/orders.service.ts` : création de commande via `calculate()` (zone de livraison obligatoire, `platformFee` env-based, `categorySystemFeeTotal`, promo) → `placeOrderWithinSession()` (décrément stock atomique `MenuInventoryService.adjustStock` + création Order dans une transaction Mongo). `preview()` réutilise `calculate()`.
- `src/modules/orders/orders.controller.ts` : `@UseGuards(JwtAuthGuard)` classe + `@RolesGuard` par route. `create`/`createFromCart` réservés `@Roles(UserRole.CLIENT)`.
- `src/database/schemas/order.schema.ts` : `deliveryAddress` `required: true`, `pricingSnapshot` (itemsSubtotal, packagingTotal, deliveryFee, platformFee, promoDiscount, paymentAmount, grandTotal, categorySystemFeeTotal, balanceDistributionVersion:3). Pas de notion de type de commande.
- `src/modules/payments/utils/order-balance-distribution.util.ts` : répartition v3 — `systemAmount = categoryFees + systemDeliveryShare + platformFee`, `restaurantAmount = items + packaging − promo − categoryFees`, `driverAmount = deliveryFee × 0.85`. Avec `deliveryFee=0`, `categoryFees=0`, `platformFee=0` → **100 % au restaurant** sans toucher au calcul.
- `src/modules/payments/payments.service.ts` : `initiateDirectPayment()` (L838) — `assertDirectChargeOwner()` (L533) **CLIENT propriétaire uniquement** ; `resolveDirectChargePhone()` accepte `dto.phone` override + validation format/opérateur (`ORANGEMONEY`/`MTN`) ; idempotence Payment `PROCESSING` unique (index 11000), `PAYMENT_OUTCOME_UNKNOWN` géré, webhook DigiKuntz avec réinterrogation source-de-vérité.
- `src/modules/payments/payments.controller.ts` : `POST /payments/initiate-direct/:orderId` → `@Roles(UserRole.CLIENT)` ; `POST /payments/initiate/:orderId` (lien hébergé) → déjà ADMIN/MANAGER/EMPLOYEE/CLIENT ; `POST /payments/sync/:orderRef` → idem.
- `src/modules/menu/menu.service.ts` `findPublicByRestaurant()` (L145) : filtre `restaurantId + isActive + isAvailable` (+ categoryId/q). Aucun filtre canal.
- `src/modules/menu/dto/create-menu-item.dto.ts` / `update-menu-item.dto.ts` : style `@ApiProperty + @Transform + class-validator` booléen (`value === 'true' || value === true`).
- `src/database/schemas/menu-item.schema.ts` : **aucun champ** `onSite`/`onDelivery`.
- `src/common/utils/order-status-transition.util.ts` : transitions manuelles PAID→CONFIRMED→PREPARING→READY (manager/employee inclus) — flux on-site couvert tel quel.
- Crons : `@nestjs/schedule` + `CronLeaseService` (`src/common/cron-lease/`), timezone `Africa/Douala` (ex. `balances.service.ts` L1316). **`qrcode@1.5.4` déjà installé** (utilisé par `whatsapp.service.ts`).
- `src/main.ts` : preflight OPTIONS maison avant tout guard (L25-45) + `setGlobalPrefix('api')` (L96) + CORS liste blanche (`cors.util`). socket.io devra cohabiter.
- Scripts : `npm run build` (nest build), `npm test` (jest, `testRegex .*\.spec\.ts$`), `ts-node src/scripts/*.ts` pour les migrations (ex. `fix-balance-transactions.ts`).
- Pas de socket.io, pas de dossier `test/` d'intégration dédié (tests supertest à créer dans `src/**/*.spec.ts` ou un nouveau dossier couvert par testRegex).

**Frontend** `/Users/flambel/Documents/GitHub/eat-app` — Angular 16, NgModules, lazy-loading, Karma/Jasmine, SCSS custom + ngx-toastr (⚠️ **pas de @angular/material** dans package.json — suivre le style SCSS existant) :
- `src/app/app-routing.module.ts` : modules lazy `public`, `auth`, `client`, `profile`, `balance`, `admin` (guard admin), `manager` (guard manager|employee), `driver`.
- `src/app/core/guards/auth.guard.ts` : redirige vers `/login` **sans returnUrl** ; `src/app/core/guards/role.guard.ts` : `data.roles`, `auth.redirectToLogin(router.url)`.
- `src/app/features/auth/login/login.component.ts` L108 : **lit déjà `returnUrl`** (query param, doit commencer par `/`) → il suffit de transmettre le returnUrl depuis AuthGuard.
- `src/app/features/client/checkout/checkout.component.ts` : étapes zone → récap → paiement ; le paiement est délégué à `app-direct-payment` (`src/app/features/orders/components/direct-payment/direct-payment.component.ts`) qui appelle `PaymentsService.initiateDirectCharge(orderId, {phone, paymentMethodCode})` et poll `/payments/:orderId/status`. **Réutilisable tel quel** pour la page on-site.
- `src/app/core/services/menu.service.ts` : `listPublicByRestaurant()` ; `orders.service.ts` : `preview/create/createFromCart` ; `payments.service.ts` : `initiateDirectCharge`, `status`, `sync`.
- `src/app/core/services/cart.service.ts` : panier CLIENT synchronisé backend (`CartApiService`) — **ne pas réutiliser** pour la page staff (le backend cart est lié au flux client) ; faire un panier local dédié.
- `src/app/features/public/restaurant-detail/restaurant-detail.component.ts` : pattern d'affichage catégories (`categoryService.list(1,100,'',true)`) + items par restaurant — analogue le plus proche de la page de commande.
- Formulaires repas : `manager-menu-create` (objet `form` simple + payload dans `save()`), `manager-menu-edit`, `admin-menu-item-detail` (même structure), `ImageDropZoneComponent` (`src/app/components/image-drop-zone/`).
- Scripts : `npm run build` (ng build), `npm test` (Karma), `ng serve`. **Pas de Playwright** installé (à créer).

**Conventions à suivre** : DTO class-validator + `@ApiProperty`/`@Transform` ; guards `JwtAuthGuard` + `RolesGuard` + `@Roles` ; modules `<domaine>.module.ts` avec controller/service/dto ; schemas `@Schema({ timestamps: true })` + `SchemaFactory` ; audit-logs `auditLogs.record({...})` sur les actions sensibles ; réponses paginées `buildPaginationMeta/normalizePagination` ; erreurs `BadRequestException({code, message, items})` pour `INSUFFICIENT_STOCK` ; SCSS sans Material.

---

## 3. Schémas Mongoose proposés

### 3.1 `MenuItem` (extension — `src/database/schemas/menu-item.schema.ts`)
```ts
@Prop({ default: true }) onSite: boolean;      // commandable sur place
@Prop({ default: true }) onDelivery: boolean;  // commandable en livraison
```
Index ajouté : `{ restaurantId: 1, onSite: 1, isAvailable: 1, isActive: 1 }`.
⚠️ Mongoose n'applique les defaults qu'à la création : **backfill obligatoire** (voir §6.1).

### 3.2 `Order` (extension — `src/database/schemas/order.schema.ts`)
```ts
@Prop({ enum: ['delivery', 'on_site'], default: 'delivery' }) orderType: string;
// deliveryAddress : `required: true` retiré au niveau schema ; la contrainte
// "adresse obligatoire" est déplacée dans le service (placeOrderWithinSession
// refuse une commande delivery sans adresse complète). Aucun doc existant impacté.
```
Index ajouté : `{ restaurantId: 1, orderType: 1, orderStatus: 1, createdAt: -1 }`.

### 3.3 `TablePosition` (nouveau — `src/database/schemas/table-position.schema.ts`)
```ts
@Schema({ timestamps: true })
export class TablePosition {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId;
  @Prop({ required: true, unique: true }) idQr: string;        // 12 chars base64url, généré
  @Prop({ required: true }) label: string;                      // ex. "Table 3"
  @Prop({ default: true }) isActive: boolean;
}
export const TablePositionSchema = SchemaFactory.createForClass(TablePosition);
```
Index : `{ restaurantId: 1, isActive: 1 }` ; unique sur `idQr`.

### 3.4 `ChatUser` (avatar — `src/database/schemas/chat-user.schema.ts`)
```ts
@Schema({ timestamps: true })
export class ChatUser {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'TablePosition', required: true }) positionId: Types.ObjectId;
  @Prop({ required: true, match: /^[a-zA-Z0-9]+$/ }) pseudo: string;
  @Prop({ required: true, enum: ['M', 'F'] }) sex: string;
  @Prop({ required: true }) photoUrl: string;
  @Prop({ enum: ['online', 'offline'], default: 'online' }) status: string;
  @Prop({ default: {} }) socialUrls: { web?: string; facebook?: string; snapchat?: string; instagram?: string; tiktok?: string; linkedin?: string };
  @Prop({ default: false }) isVerified: boolean;
  @Prop({ default: false }) isPersistant: boolean;
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) userId?: Types.ObjectId | null;
  @Prop() expiresAt?: Date;   // ABSENT (champ non posé) pour isPersistant=true — condition TTL §6.4
}
```
Index : `{ positionId: 1, status: 1 }`, `{ restaurantId: 1 }`, et **TTL** `{ expiresAt: 1 }, { expireAfterSeconds: 0 }`.

### 3.5 `ChatMessage` (`src/database/schemas/chat-message.schema.ts`)
```ts
@Schema({ timestamps: true })
export class ChatMessage {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'TablePosition', required: true }) positionId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'ChatUser', required: true }) fromAvatarId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'ChatUser', default: null }) toAvatarId?: Types.ObjectId | null; // null = groupe/table
  @Prop({ required: true, maxlength: 1000 }) content: string;
  @Prop({ required: true }) expiresAt: Date;   // createdAt + 10h
}
```
Index : `{ positionId: 1, createdAt: -1 }`, **TTL** `{ expiresAt: 1 }, { expireAfterSeconds: 0 }`.

### 3.6 `CreateOnSiteOrderDto` (`src/modules/orders/dto/create-on-site-order.dto.ts`)
```ts
export class OnSiteOrderItemDto {
  @IsString() @IsMongoId() menuItemId: string;
  @IsInt() @Min(1) quantity: number;
  @IsOptional() @IsString() accompanimentId?: string;
  @IsOptional() @IsString() accompanimentName?: string;
}
export class CreateOnSiteOrderDto {
  @IsString() @IsMongoId() restaurantId: string;     // obligatoire pour admin, ignoré/revalidé pour manager|employee
  @IsArray() @ValidateNested({ each: true }) @Type(() => OnSiteOrderItemDto) items: OnSiteOrderItemDto[];
  @IsOptional() @IsString() @MaxLength(200) tableLabel?: string;   // ex. "Table 3" (Phase 2: positionId)
  @IsOptional() @IsString() notes?: string;
}
```

---

## 4. PHASE 1 — Commandes on-site : tâches

### T1 (B) — Champs `onSite`/`onDelivery` sur le schema MenuItem + backfill — **S**
- Fichiers : `src/database/schemas/menu-item.schema.ts` (2 @Prop default true + index), nouveau `src/scripts/backfill-menu-item-channels.ts`, `package.json` (script `backfill:menu-channels`).
- Esquisse : script style `fix-balance-transactions.ts` → `MenuItem.updateMany({ $or: [{ onSite: { $exists: false } }, { onDelivery: { $exists: false } }] }, { $set: { onSite: true, onDelivery: true } })` avec log du `modifiedCount`. Idempotent.
- Preuve : `npm test` (menu.service.spec étendu, T3) + exécution du script sur la base de dev → `modifiedCount` = nombre d'items existants ; re-exécution → 0.
- Dépend de : rien.

### T2 (B) — DTOs Create/Update + pass-through service — **S**
- Fichiers : `src/modules/menu/dto/create-menu-item.dto.ts`, `update-menu-item.dto.ts` (2 champs `@IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean()`), `src/modules/menu/menu.service.ts` (`createForActor`/`updateForActor` : vérifier que le mapping dto→doc propage bien les champs ; ajouter au besoin).
- Preuve : test unitaire menu.service : création avec `onSite: false` persiste la valeur ; sans le champ → `true` (default).
- Dépend de : T1.

### T3 (B) — Filtre canal sur la liste publique — **S**
- Fichiers : `src/modules/menu/menu.service.ts` (`findPublicByRestaurant` : param `filters.onSite` → `filter.onSite = { $ne: false }` — défensif contre les docs non backfillés), `src/modules/menu/menu.controller.ts` (query `@Query('onSite')`), `src/modules/menu/dto/menu-item-response.dto.ts` si réponse typée.
- Preuve : spec menu.service : 3 items (onSite true/false/absent) + `onSite=true` → 2 résultats.
- Dépend de : T1.

### T4 (B) — Order schema : `orderType` + `deliveryAddress` optionnel — **S**
- Fichiers : `src/database/schemas/order.schema.ts` (§3.2 + index), `src/modules/orders/orders.service.ts` (`placeOrderWithinSession` : garde `if (orderType === 'delivery' && !(dto.city && dto.district && dto.details)) throw new BadRequestException('Adresse de livraison requise')` — la zone est déjà validée dans `calculate()`).
- Preuve : `npm test` — les specs existantes passent (aucune commande delivery sans adresse ne peut plus être créée) ; nouveau test : commande delivery sans adresse → 400.
- Dépend de : rien.

### T5 (B) — Service `createOnSite` + calcul on-site — **M**
- Fichiers : `src/modules/orders/dto/create-on-site-order.dto.ts` (§3.6), `src/modules/orders/orders.service.ts` :
  - `calculateOnSite(dto, session?)` : réutilise la validation de `calculate()` (items → menuItems, stock, accompagnements, limite maxItemsPerOrder) **mais** : pas de zone, `deliveryFee = 0`, `platformFee = 0`, `packagingTotal = 0` (le total = somme des prix), `promoDiscount = 0` (pas de promos on-site), `categorySystemFeeTotal = 0` (100 % au restaurant), `paymentAmount = itemsSubtotal`, `balanceDistributionVersion: 3`. **Nouveau filtre : `onSite: { $ne: false }`** dans la requête menuItems → item non-onSite ⇒ `INSUFFICIENT_STOCK`/`unavailable` structuré.
  - `createOnSite(actor, dto)` : rôle ADMIN/MANAGER/EMPLOYEE ; manager/employee → `restaurantId` **forcé** à `actor.restaurantId` (refus 403 si dto.restaurantId ≠ sien) ; `order.userId = actor.sub` (le personnel crée au nom du client de table) ; `orderType: 'on_site'`, pas de `deliveryAddress`, pas de `deliveryEstimateMinutes`, `assignedDriverId` jamais posé. Transaction + décrément stock identiques à `placeOrderWithinSession` (extraire le décrément stock en helper commun `reserveStockWithinSession`). `auditLogs.record({ action: 'order.create_on_site', actorRole: actor.role, ... })`.
- Preuve : `src/modules/orders/orders.service.spec.ts` (créer/étendre) : création OK avec snapshot `paymentAmount = Σ price×qty`, `deliveryFee=0`, `platformFee=0`, `categorySystemFeeTotal=0` ; refus item `onSite: false` ; refus item épuisé ; refus manager d'un autre restaurant ; `orderBalanceDistribution(order)` → `restaurantAmount === paymentAmount`, `systemAmount === 0`, `driverAmount === 0` (réutiliser `order-balance-distribution.util.spec.ts`).
- Dépend de : T1, T4.

### T6 (B) — Endpoint `POST /orders/on-site` + intégration supertest — **S**
- Fichiers : `src/modules/orders/orders.controller.ts` (`@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE) @UseGuards(RolesGuard) @Post('on-site')` — **avant** `@Get(':id')` pour éviter le conflit de routing), `src/modules/orders/dto/order-response.dto.ts` (si type de réponse à enrichir).
- Preuve : test d'intégration supertest (nouveau `src/modules/orders/orders.controller.int.spec.ts` ou fichier couvert par `testRegex`) : appel authentifié manager → 201 ; client → 403 ; DTO invalide (quantity 0) → 400 via ValidationPipe.
- Dépend de : T5.

### T7 (B) — Paiement direct par le personnel — **M**
- Fichiers : `src/modules/payments/payments.controller.ts` (L113-115 : `@Roles(ADMIN, MANAGER, EMPLOYEE, CLIENT)`), `src/modules/payments/payments.service.ts` (`assertDirectChargeOwner` L533 : ajouter la branche staff — ADMIN ok, MANAGER/EMPLOYEE ok **si** `order.restaurantId === actor.restaurantId` **et** `order.orderType === 'on_site'` ; CLIENT inchangé). Tout le reste (idempotence, `PAYMENT_OUTCOME_UNKNOWN`, webhook, `ensurePaidOrderBalances`) **inchangé** : avec `deliveryFee=0` et `categoryFees=0`, la répartition v3 crédite 100 % au restaurant sans modification du util.
- Preuve : `payments.service.direct.spec.ts` — manager du restaurant → 200 ; manager d'un autre restaurant → 403 ; commande `delivery` → 403 pour le staff ; CLIENT inchangé. Vérifier `ensurePaidOrderBalances` sur une commande on-site : aucune part livreur, restaurant crédité du montant total.
- Dépend de : T5.

### T8 (F) — Modèles + services frontend — **S**
- Fichiers : `src/app/core/models/menu-item.model.ts` (+`onSite`/`onDelivery`), `src/app/core/models/order.model.ts` (+`orderType`, `CreateOnSiteOrderPayload`, `tableLabel`), `src/app/core/services/menu.service.ts` (`listPublicByRestaurant(..., onSite?: boolean)`), `src/app/core/services/orders.service.ts` (`createOnSite(payload)` → `POST /orders/on-site`).
- Preuve : specs Karma services (mock `ApiService`), cohérence payload avec DTO §3.6.
- Dépend de : contrats figés (§5).

### T9 (F) — Formulaires repas manager + admin — **S**
- Fichiers : `src/app/features/manager/manager-menu-create/manager-menu-create.component.ts` + `.html` (2 cases à cocher `onSite`/`onDelivery` default true dans `form` et dans le payload de `save()`), `manager-menu-edit/*` (préremplissage depuis l'item), `src/app/features/admin/admin-menu-item-detail/admin-menu-item-detail.component.ts` + `.html` (idem ; `admin-menu-items` : badge optionnel « Sur place / Livraison » dans la liste).
- Preuve : specs Karma composants : form initial onSite=true ; payload `save()` contient les champs ; édition préremplit depuis l'item chargé.
- Dépend de : T8.

### T10 (F) — Nouveau module `features/restaurant` + page de commande — **L**
- Fichiers :
  - `src/app/app-routing.module.ts` : route racine `restaurant` lazy-load `RestaurantModule` (comme `public`/`client`).
  - `src/app/features/restaurant/restaurant.module.ts` + `restaurant-routing.module.ts` : route `table/commande/:idRestaurant` avec `canActivate: [AuthGuard, RoleGuard]`, `data: { roles: ['admin','manager','employee'] }`, `resolve: { tableData: TableOrderResolver }`.
  - `src/app/features/restaurant/table-order/table-order.resolver.ts` : charge en `forkJoin` restaurant (si le service existe déjà via `restaurants.service.ts`) + catégories actives (`categoryService.list(1,100,'',true)`) + items publics (`menuService.listPublicByRestaurant(id, 1, 100, '', true /* onSite */)`), filtre côté client en secours `item.onSite !== false`. Échec → `router.navigate(['/'])`.
  - `src/app/features/restaurant/table-order/table-order-page.component.ts/.html/.scss` : pattern `restaurant-detail` (onglets catégories + grille produits avec image, prix, stock) ; panier local ; bouton « Finaliser ».
  - `src/app/features/restaurant/table-order/table-order-cart.service.ts` : panier local staff (BehaviorSubject + localStorage clé `food_table_cart_<restaurantId>`), actions add/remove/inc/dec/clear, total = Σ price×qty. **Ne pas toucher à `CartService`** (flux client).
  - Étape paiement : réutiliser `app-direct-payment` (`src/app/features/orders/components/direct-payment/`) — après `createOnSite()`, afficher le composant avec `orderId`, saisie téléphone client + opérateur (Orange/MTN) ; il gère polling, `PAYMENT_OUTCOME_UNKNOWN`, fallback lien hébergé. À la confirmation → écran succès + reset panier.
- Preuve : specs Karma : resolver charge & filtre onSite ; panier local persiste ; « Finaliser » appelle `createOnSite` avec le bon payload ; gestion erreur `INSUFFICIENT_STOCK`.
- Dépend de : T8, T9 (contrats).

### T11 (F) — Checklist de cohérence paiement staff — **S**
- Vérifier : `api.service.ts` envoie bien le JWT staff ; `direct-payment.component` ne suppose pas un rôle CLIENT (il ne le fait pas — il appelle `initiateDirectCharge`); l'intercepteur toast global : la page staff doit garder le pattern `silentErrors()` déjà en place côté service.
- Preuve : revue + spec Karma d'intégration légère page ↔ composant paiement.
- Dépend de : T10.

### T12 (E2E) — Setup Playwright + flux critique — **M**
- Fichiers : `eat-app/package.json` (devDep `@playwright/test`, scripts `e2e` / `e2e:headed`), `eat-app/playwright.config.ts` (baseURL via env, webServer `ng serve` ou build+`ng serve --port`), `eat-app/e2e/table-order.e2e.spec.ts` + page objects `eat-app/e2e/pages/`.
- Scénario : login admin/manager → `/restaurant/table/commande/:idRestaurant` → ajout items → Finaliser → saisie téléphone + opérateur → paiement (mock/`PAYMENT_OUTCOME_UNKNOWN` safe : valider l'UI jusqu'à l'état prompt/refus ; la confirmation réelle requiert DigiKuntz — marquer l'étape paiement en `@stub` avec mock backend ou route interceptée).
- Preuve : `npx playwright test`.
- Dépend de : T6, T10, T11.

---

## 5. PHASE 2 — yChat : tâches

### T13 (B) — Dépendances socket.io + configuration — **S**
- Fichiers : `eat-app-backend/package.json` (`@nestjs/websockets@^10`, `@nestjs/platform-socket.io@^10`, `socket.io@^4`), `src/main.ts` — vérifier que le middleware OPTIONS maison (L25-45) n'absorbe pas le handshake engine.io : engine.io s'attache au listener `request` du serveur HTTP **avant** Express (removeAllListeners/re-add), donc le handshake passe ; sinon déplacer/exceptionner `path: '/socket.io'`. Configurer `cors.origin` du gateway avec `buildCorsOrigins()` (réutiliser `cors.util`).
- Preuve : `npm run build` + smoke test gateway (T18).
- Dépend de : rien (Phase 2).

### T14 (B) — Schemas + module chat — **M**
- Fichiers : `src/database/schemas/table-position.schema.ts`, `chat-user.schema.ts`, `chat-message.schema.ts` (§3.3-3.5), `src/modules/chat/chat.module.ts` (imports MongooseModule.forFeature + enregistrement dans `src/app.module.ts`).
- Preuve : `npm test` ; vérifier au démarrage que les index TTL sont créés (`db.chatMessages.getIndexes()`).
- Dépend de : rien.

### T15 (B) — Positions de table + QR — **M**
- Fichiers : `src/modules/chat/chat.controller.ts`, `chat.service.ts`, `dto/create-table-position.dto.ts` (label requis, restaurantId optionnel pour admin).
- Endpoints (§5 contrats) : `POST /chat/positions` (admin/manager — manager forcé à son restaurant), `GET /chat/positions` (scoped par rôle), `PATCH /chat/positions/:id` (activate/désactiver), `GET /chat/positions/:id/qr` → `{ dataUrl, url }` via `qrcode` déjà installé (URL = `${FRONTEND_URL}/restaurant/yChat?idQr=...`), `GET /chat/positions/by-qr/:idQr` (public, AuthGuard requis car yChat exige une session) → position + restaurantId ou 404.
- `idQr` : `randomUUID().replace(/-/g,'').slice(0,12)` + unique index + retry en cas de collision 11000.
- Preuve : specs service (création, unicité, scoping manager, by-qr 404).
- Dépend de : T14.

### T16 (B) — Avatars : création, liste, suppression cascade — **M**
- Fichiers : `src/modules/chat/chat.controller.ts`, `chat.service.ts`, `dto/create-chat-avatar.dto.ts`.
- Validation : pseudo `@Matches(/^[a-zA-Z0-9]+$/)` (pas de ponctuation/emoji — le regex le garantit), sex requis (`M|F`), `photoUrl` requis (liste d'avatars prédéfinis ou upload via `POST /uploads/:folder` existant), `socialUrls` optionnels (champs url validés `@IsUrl` ou `@IsString` + normalisation), `isPersistant` accepté **seulement si** `userId` fourni (refus 400 sinon). `expiresAt = now + 12h` posé uniquement si non-persistant ; `status: 'online'`.
- `DELETE /chat/avatars/:id` : supprime l'avatar **et** `ChatMessage.deleteMany({ $or: [{ fromAvatarId: id }, { toAvatarId: id }] })` (cascade immédiate), + émission socket `avatar:left` (T18).
- Preuve : specs : pseudo invalide → 400 ; `isPersistant` sans userId → 400 ; non-persistant → `expiresAt` ≈ +12h ; persistant → champ absent ; suppression cascade → 0 messages restants.
- Dépend de : T14.

### T17 (B) — Messages + TTL + cron de nettoyage cascade — **M**
- Fichiers : `src/modules/chat/chat.service.ts` (méthodes messages), `chat.controller.ts`, `dto/create-chat-message.dto.ts`.
- `POST /chat/messages` : fromAvatarId doit appartenir au restaurant/position ; `toAvatarId` optionnel (null = groupe/table) ; `content` requis (max 1000) ; `expiresAt = createdAt + 10h` ; émission socket `message:new`.
- `GET /chat/messages?positionId=...` : filtre `expiresAt > now` (double protection avec l'index TTL), tri `createdAt: -1`, pagination `normalizePagination`.
- Cron : `@Cron('*/10 * * * *', { timeZone: 'Africa/Douala' })` protégé par `CronLeaseService` (pattern `payments.service.ts` L1359) : supprime les `ChatUser` expirés restants (au cas où le TTL traîne) en cascade sur leurs messages, et les messages orphelins (`fromAvatarId` sans avatar). Log `modifiedCount`.
- Preuve : specs : message de groupe vs privé ; messages expirés exclus de la liste ; cron cascade supprime avatar expiré + messages ; messages orphelins nettoyés.
- Dépend de : T16.

### T18 (B) — Gateway socket.io — **M**
- Fichiers : `src/modules/chat/chat.gateway.ts` (`@WebSocketGateway({ path: '/socket.io', cors: <origins cors.util> })`), `src/modules/chat/chat-auth.util.ts` (vérification JWT du handshake via `JwtService` — **optionnelle** : connexion acceptée sans token, mais le produit exige une session côté frontend ; le token est simplement utilisé pour tracer `userId`).
- Rooms : `join` → `socket.join('position:'+positionId)` après validation que la position existe ; événements émis : `message:new` (§T17), `avatar:joined` (création avatar), `avatar:left` (disconnect du socket possédant l'avatar + suppression/création), `avatar:updated` (optionnel).
- Preuve : test d'intégration `socket.io-client` (supertest + client io) : deux clients dans la même room reçoivent `message:new` ; client hors room ne le reçoit pas.
- Dépend de : T13, T16, T17.

### T19 (F) — Dépendance client + `YChatService` — **M**
- Fichiers : `eat-app/package.json` (`socket.io-client@^4`), `src/app/core/services/ychat.service.ts` (ou `src/app/features/ychat/services/ychat.service.ts` — suivant la convention de co-location : les services client restent dans `core/services`, mettre `ychat.service.ts` dans `core/services`).
- Contenu : connexion `io(environment.socketUrl, { path: '/socket.io', auth: { token } })`, `join(positionId)`, observables `messages$`, `avatars$`, `connected$` ; écoute `message:new`, `avatar:joined`, `avatar:left` ; cache local des messages avec `expiresAt` (10h) et nettoyage `localStorage` (`food_ychat_msgs_<positionId>`) au démarrage ; envoi via REST `POST /chat/messages` (source de vérité) puis réception par socket.
- Preuve : specs Karma : TTL local (message expiré purgé), événements socket mappés, reconnexion.
- Dépend de : T18 (contrats d'événements).

### T20 (F) — Route `/restaurant/yChat` + resolver + returnUrl — **S**
- Fichiers : `src/app/features/restaurant/restaurant-routing.module.ts` (Phase 1) : route `yChat` avec `canActivate: [AuthGuard]` et `resolve: { ychat: YChatResolver }` ; `src/app/core/guards/auth.guard.ts` : **ajouter returnUrl** (`this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } })` — login lit déjà `returnUrl` L108).
- `YChatResolver` : lit `?idQr=` (query param prioritaire) → sauvegarde `localStorage('food_ychat_qr')` → appelle `GET /chat/positions/by-qr/:idQr` (via `YChatService`/`ChatApiService`) ; invalide/absent → `router.navigate(['/'])` et retour `null` (ou `UrlTree`).
- Preuve : specs Karma : idQr valide charge la position ; invalide → redirect `/` ; localStorage sauvegardé ; AuthGuard redirige avec `returnUrl=/restaurant/yChat?idQr=...`.
- Dépend de : T15, T19.

### T21 (F) — Composants yChat — **L**
- Fichiers : `src/app/features/ychat/` — `ychat-page.component.ts/.html/.scss` (container), `chat-header/` (avatar + pseudo + logo restaurant), `table-chat/` (liste messages groupe + input), `user-list/` (avatars connectés cliquables → chat privé via `toAvatarId`), `floating-menu/` (search/settings/commander), `avatar-modal/` (création d'avatar avec modal d'introduction).
- Formulaire avatar : `ReactiveForm` — validators pseudo `^[a-zA-Z0-9]+$`, sex requis, photo requise (liste d'avatars prédéfinis OU upload via `ImageDropZoneComponent` + `POST /uploads/:folder`), socials optionnels, checkbox `isPersistant` affichée seulement si `auth.isLoggedIn() && userId` (toujours vrai côté produit — session obligatoire).
- Preuve : specs Karma composants (validation, affichage conditionnel, clic user-list → privé, envoi message).
- Dépend de : T19, T20.

### T22 (F) — Bouton « Commander » → Phase 1 — **S**
- Fichiers : `src/app/features/ychat/floating-menu/floating-menu.component.ts/.html` : bouton « Commander » → `router.navigate(['/restaurant/table/commande', restaurantId])` (restaurantId connu via resolver yChat). Un utilisateur CLIENT est refusé par le RoleGuard de la page on-site : **décision à valider** — soit autoriser CLIENT sur la page on-site (c'est le client de table qui commande via son propre téléphone), soit le staff reste l'unique créateur. Par défaut : le bouton n'est actif que pour les rôles staff ; pour un client, on peut afficher un message ou le cacher. *(Point d'attention, voir §6.3.)*
- Preuve : spec Karma navigation.
- Dépend de : T10, T21.

### T23 (B) — Tests d'intégration chat (supertest) — **M**
- Fichiers : `src/modules/chat/chat.int.spec.ts` : positions CRUD scoping ; avatars (validation, TTL 12h, cascade) ; messages (liste non expirée, expiration) ; by-qr.
- Preuve : `npm test`.
- Dépend de : T15–T17.

### T24 (E2E) — Playwright yChat — **M**
- Fichiers : `eat-app/e2e/ychat.e2e.spec.ts` + page objects.
- Scénarios : idQr invalide → redirect `/` ; non connecté → login avec retour ; création avatar (validation pseudo) ; envoi message visible par un 2e contexte (2 onglets Playwright) ; expiration (injecter `expiresAt` passé → message absent).
- Preuve : `npx playwright test`.
- Dépend de : T20–T23.

### T25 (B) — Endpoint staff « positions par restaurant » UI admin/manager — **S**
- Fichiers : `src/app/features/manager/` + `src/app/features/admin/` : page simple de gestion des positions (créer label → afficher QR imprimable). Optionnel mais nécessaire pour générer les QR en pratique.
- Preuve : specs Karma ; E2E création position.
- Dépend de : T15.

---

## 6. Contrats API (résumé)

| Méthode | Path | Rôles | DTO | Réponse |
|---|---|---|---|---|
| GET | `/menu-items/public/:restaurantId?onSite=true` | public | — | `PaginatedMenuItemsResponseDto` (items onSite uniquement) |
| POST | `/orders/on-site` | admin, manager, employee | `CreateOnSiteOrderDto` | `OrderResponseDto` (`orderType: 'on_site'`, `pricingSnapshot.paymentAmount = Σ prix`) |
| POST | `/payments/initiate-direct/:orderId` | admin, manager, employee, client | `InitiateDirectChargeDto` (phone, ORANGEMONEY/MTN) | `DirectChargeInitiateResponseDto` — staff limité aux commandes on_site de son restaurant |
| POST | `/payments/initiate/:orderId`, `/payments/sync/:orderRef` | inchangé | — | inchangé |
| POST | `/chat/positions` | admin, manager | `CreateTablePositionDto` | `TablePosition` |
| GET | `/chat/positions` | admin, manager, employee | — | paginé, scoping rôle |
| PATCH | `/chat/positions/:id` | admin, manager | `{ isActive, label }` | `TablePosition` |
| GET | `/chat/positions/:id/qr` | admin, manager | — | `{ dataUrl, url }` |
| GET | `/chat/positions/by-qr/:idQr` | authentifié (session requise) | — | `{ position, restaurantId }` ou 404 |
| POST | `/chat/avatars` | authentifié | `CreateChatAvatarDto` | `ChatUser` |
| GET | `/chat/avatars?positionId=` | authentifié | — | `ChatUser[]` (online/offline) |
| DELETE | `/chat/avatars/:id` | authentifié (propriétaire de l'avatar) | — | 200, cascade messages |
| POST | `/chat/messages` | authentifié | `CreateChatMessageDto` | `ChatMessage` |
| GET | `/chat/messages?positionId=&page=&limit=` | authentifié | — | paginé, non expirés |
| Socket | room `position:<id>` | auth optional | `join` | events `message:new`, `avatar:joined`, `avatar:left` |

---

## 7. Plan de tests par tâche (récapitulatif)

| Tâche | Type | Tests |
|---|---|---|
| T1–T3 | Jest | menu.service.spec : defaults, backfill effet, filtre onSite |
| T4–T5 | Jest | orders.service.spec : createOnSite (succès, refus canal, refus stock, refus cross-restaurant, snapshot pricing 100 % restaurant) |
| T6 | Jest supertest | orders.controller.int.spec : 201/403/400 |
| T7 | Jest | payments.service.direct.spec : staff owner, cross-restaurant, on_site only, CLIENT inchangé |
| T8–T11 | Karma | models/services specs, formulaires, resolver, page, panier local |
| T12 | Playwright | login → commande → paiement (mocké) |
| T14–T17, T23 | Jest | chat unit + int : TTL, cascade, validation, scoping |
| T18 | Jest + socket.io-client | gateway rooms/events |
| T19–T22 | Karma | ychat.service TTL local, resolver, composants, validators |
| T24 | Playwright | idQr, avatar, message, expiration |

---

## 8. Risques et points d'attention

1. **Migration MenuItems existants (§6.1)** — les defaults Mongoose ne rétro-agissent pas. Stratégie : backfill script idempotent (`npm run backfill:menu-channels`) à exécuter au déploiement **avant** la mise en ligne de la page on-site, + filtre défensif `onSite: { $ne: false }` dans la requête (jamais `onSite: true` seul) tant que le backfill n'est pas prouvé. `onDelivery` backfillé à `true` → comportement inchangé pour la livraison.
2. **`deliveryAddress` devient optionnel** — vérifier tous les usages : `payments.service` (recherche q sur `deliveryAddress.city` → les champs absents ne matchent pas, OK), `deliveries.service` L90 (`order.deliveryAddress || {}` OK), `orders.service` L198 (idem). Aucune commande `delivery` sans adresse ne peut plus être créée (garde dans `placeOrderWithinSession`). Pas de migration de données.
3. **Qui paie ?** — décision produit : le personnel (admin/manager/employee) initie le paiement direct au nom du client de table (téléphone du client saisi dans l'UI). Le client authentifié (rôle CLIENT) ne peut pas créer de commande on-site ; le bouton « Commander » de yChat n'est actif que pour le personnel. Si le client doit payer lui-même depuis yChat, il faudra élargir `createOnSite` au rôle CLIENT (petit delta, à décider avant T10/T22).
4. **TTL Mongo et cascade** — l'index TTL supprime le document mais pas ses messages. Deux protections : (a) cascade à la suppression manuelle d'avatar (T16) ; (b) cron `*/10 min` avec `CronLeaseService` (T17) pour les avatars expirés et messages orphelins. ⚠️ TTL : pour `isPersistant: true`, **ne pas poser** `expiresAt` (champ absent = jamais expiré ; un `expiresAt: null` est aussi ignoré par TTL mais posé explicitement à null est trompeur — préférer l'absence).
5. **Frais de catégorie sur on-site** — `systemFeePerItem` des catégories est crédité au compte système. Le client exige « 100 % reversé au restaurant » → `calculateOnSite` force `categorySystemFeeTotal = 0` (et `platformFee = 0`, `deliveryFee = 0`, `packagingTotal = 0`, `promoDiscount = 0`). Alternative (si le client veut conserver les frais de catégorie) : retirer la mise à zéro et la répartition v3 s'applique telle quelle — décision à confirmer, impact T5 uniquement.
6. **`platformSettings.assertOrderingOpen()`** — appliqué aux commandes livraison (orders.service L444). Décision : l'appliquer aussi au on-site (mêmes heures de service). Sinon, contournement par API possible des heures de fermeture.
7. **socket.io vs middleware OPTIONS maison** (`main.ts` L25-45) — engine.io s'attache au serveur HTTP avant Express ; en théorie le handshake n'atteint pas le middleware. À vérifier en smoke test (T13/T18) : si le preflight socket.io est avalé, ajouter une exception `path.startsWith('/socket.io')`.
8. **CORS socket.io** — réutiliser `buildCorsOrigins()` (`cors.util`) pour le gateway, pas de seconde liste d'origins.
9. **`FINANCE` — invariant de répartition** — toute commande on-site doit passer `isDistributionBalanced()` : `restaurantAmount = paymentAmount`, `systemAmount = 0`, `driverAmount = 0`. Les crons de réconciliation (payments.service) traitent ces commandes comme les autres — vérifier qu'aucune part livreur n'est attendue (`driverShareSettledAt` constaté nul).
10. **AuthGuard returnUrl** — modification minimale de `auth.guard.ts` (1 ligne) ; `login.component.ts` L108 gère déjà le retour. Vérifier que `returnUrl.startsWith('/')` exclut `/login` (déjà fait côté login).
11. **Conflit de routing** — `POST /orders/on-site` doit être déclaré avant `@Get(':id')` dans `orders.controller.ts` (méthodes POST et GET sur paths distincts : pas de conflit réel, mais garder l'ordre pour la lisibilité).
12. **Stock on-site** — réutiliser le décrément atomique existant (`MenuInventoryService.adjustStock` dans la transaction) et la réserve de retry de `payments.service` — aucun nouveau mécanisme d'inventaire.
13. **Pas de socket.io dans le frontend aujourd'hui** — `socket.io-client` est une nouvelle dépendance ; Angular 16 + zone.js : les callbacks socket doivent passer par `NgZone.run` (ou `zone.runOutsideAngular` + signals/BehaviorSubject) pour garantir la détection de changements.
14. **photoUrl avatars** — réutiliser `POST /uploads/:folder` existant (uploads module) ou une liste d'avatars prédéfinis servie statiquement ; ne pas créer un nouveau mécanisme d'upload.

---

## 9. Estimation d'ordre de grandeur

| Tâche | Taille | Tâche | Taille |
|---|---|---|---|
| T1 schema+backfill | S (0.5j) | T14 schemas+module | M (1j) |
| T2 DTOs | S (0.25j) | T15 positions+QR | M (1j) |
| T3 filtre public | S (0.25j) | T16 avatars+cascade | M (1j) |
| T4 order schema | S (0.5j) | T17 messages+TTL+cron | M (1j) |
| T5 createOnSite | M (1-1.5j) | T18 gateway | M (1-1.5j) |
| T6 endpoint+int | S (0.5j) | T19 YChatService | M (1j) |
| T7 paiement staff | M (1j) | T20 route+resolver | S (0.5j) |
| T8 modèles/services | S (0.5j) | T21 composants yChat | L (2-3j) |
| T9 formulaires | S (0.5j) | T22 bouton commander | S (0.25j) |
| T10 page commande | L (2-3j) | T23 tests int chat | M (1j) |
| T11 cohérence paiement | S (0.25j) | T24 E2E yChat | M (1j) |
| T12 E2E setup+flux | M (1-1.5j) | T25 UI positions | S (0.5j) |

**Phase 1 ≈ 9-11 j** · **Phase 2 ≈ 12-14 j** (hors revue/QA croisée).

---

## 10. Validation (commandes réelles du projet)

```bash
# Backend (eat-app-backend)
npm run build          # nest build
npm test               # jest (testRegex .*\.spec\.ts$)
npm run start:dev      # nest start --watch

# Migration (une fois, avant mise en ligne Phase 1)
npm run backfill:menu-channels   # script à créer (T1)

# Frontend (eat-app)
npm run build          # ng build
npm test               # ng test (Karma, Chrome headless en CI)

# E2E (à créer en T12)
npx playwright test    # eat-app/e2e/
```

Aucun script Playwright n'existe aujourd'hui dans les deux repos : le setup (T12) crée `playwright.config.ts` et les scripts npm `e2e`. Les commandes ci-dessus sont tirées des `package.json` réels (`eat-app-backend/package.json` : build/test/start:dev ; `eat-app/package.json` : start/build/test).
