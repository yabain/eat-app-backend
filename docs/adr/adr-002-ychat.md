# ADR-002 — yChat : chat éphémère par table via QR

- **Statut** : accepté
- **Date** : 2026-11-25
- **Phase** : 2 du plan `docs/plans/plan-onsite-ychat.md`

## Contexte

Chaque table d'un restaurant doit disposer d'un chat temps réel (groupe + privés) accessible en scannant un QR code, sans inscription : le client pose un avatar éphémère et discute avec les autres personnes de la table. Les données doivent disparaître automatiquement (messages ~10 h, avatars non persistants ~12 h), sauf avatar volontairement « persistant » rattaché à un compte. Une session est exigée côté produit, mais le chat ne doit pas exposer d'identité réelle (`userId` jamais projeté vers les clients).

## Décision

**Positions de table** (`TablePosition`, `src/database/schemas/table-position.schema.ts`) : `restaurantId`, `idQr` unique (12 chars base64url), `label`, `isActive`. Le QR (`GET /api/chat/positions/:id/qr`) encode l'URL `${FRONTEND_URL}/restaurant/yChat?idQr=<idQr>`. Une position désactivée rend son QR inutilisable (scan → 404). Collision d'idQr : 3 tentatives de régénération puis `409` Conflict propre.

**Avatars sans inscription mais session requise** : `GET /chat/positions/by-qr/:idQr` (résolution du QR) et `POST /chat/avatars` sont sous `JwtAuthGuard` — le produit exige une session, mais aucun rôle n'est requis. La projection publique d'un avatar n'expose jamais `userId` ni `expiresAt`.

**Formulaire d'avatar** (`CreateChatAvatarDto`) : `positionId`, `pseudo` strictement alphanumérique (`^[a-zA-Z0-9]+$`, 1–50), `sex` (`M`/`F`), `photoUrl` requis (avatar prédéfini ou upload via `POST /uploads/avatars`), `socialUrls` optionnels (web, facebook, snapchat, instagram, tiktok, linkedin — URL http/https absolues), `isPersistant` optionnel — **accepté seulement pour un utilisateur authentifié** (`userId` tracé sur l'avatar, refus 400 sinon).

**Règles de durée de vie** :
- Message : `expiresAt = createdAt + 10 h` (`CHAT_MESSAGE_TTL_HOURS`), index TTL Mongo (`expireAfterSeconds: 0`) + filtre `expiresAt > now` dans la liste (double protection).
- Avatar non persistant : `expiresAt = now + 12 h` (`CHAT_AVATAR_TTL_HOURS`) ; même index TTL.
- Avatar persistant : champ `expiresAt` **ABSENT** — condition de non-expiration de l'index TTL Mongo (un document sans le champ n'est jamais supprimé par l'index).
- **Cron cascade** `*/10 * * * *` (Africa/Douala), protégé par `CronLeaseService` (lease `chat.purge`, 9 min) : purge des avatars expirés restants (si le TTL Mongo traîne) avec cascade sur leurs messages (émetteur ET destinataire), puis purge des messages orphelins (`fromAvatarId` sans avatar). La suppression manuelle d'un avatar (`DELETE /chat/avatars/:id`, propriétaire ou admin) cascade immédiatement sur ses messages.

**Temps réel socket.io** (`chat.gateway.ts` + `chat-realtime.service.ts`, contrat figé) :
- Handshake `POST /socket.io` (CORS partagé avec l'API) ; JWT **optionnel** au handshake (`auth.token`, header ou query `token`/`Authorization`) : il sert uniquement à tracer `userId`, la connexion est acceptée sans token.
- Client → serveur : `'join' { tableId, avatarId? }` (résultat par ack, ou événement `'join:error'` en cas d'échec).
- Serveur → client : `'message:new' { message }`, `'avatar:joined' { avatar }`, `'avatar:left' { avatarId }`, `'avatar:updated' { avatar }`, `'table:removed' { tableId }` (suppression de la table), `'table:deactivated' { tableId }` (désactivation).
- Rooms : `table:<tableId>` (messages de groupe, avatars de toutes les positions de la table) et `table:<tableId>:avatar:<avatarId>` (messages privés de cet avatar).
- **Confidentialité des messages privés côté serveur** : un message privé n'est jamais diffusé à la room de la table — seulement aux rooms des deux avatars concernés. La liste REST `GET /chat/messages` (`tableId` requis, `avatarId` optionnel — sinon l'avatar le plus récent de l'actor sur la table) ne renvoie que les messages de groupe et les privés concernant l'avatar de l'actor ; les privés d'autrui ne fuient jamais.
- **Anti-spoof** : l'`avatarId` annoncé au join est validé (existe, appartient à la table, propriété du `userId` du token — un socket sans token ne peut pas usurper un avatar) ; `avatar:left` au disconnect n'est émis que pour un avatar validé.
- Envoi des messages via REST `POST /chat/messages` (source de vérité) : `tableId` requis et doit correspondre à la table de l'avatar émetteur (400 sinon), `fromAvatarId` doit appartenir à l'actor, `toAvatarId` optionnel (même table), `content` 1–1000.

## Alternatives considérées

- **SSE** : rejeté — flux unidirectionnel serveur → client, pas de rooms ciblées aussi naturellement (messages privés), pas de reconnect/ack natifs.
- **Polling REST** : rejeté — latence et coût REST élevés pour un chat de table, pas de présence temps réel (`avatar:joined` / `avatar:left`).

## Conséquences

- Deux index TTL Mongo (`chat-message.expiresAt`, `chat-user.expiresAt`) : la suppression nominative est déléguée à Mongo ; le cron ne fait que la cascade et le nettoyage des orphelins.
- Un avatar persistant ne doit jamais porter `expiresAt` : l'absence du champ est l'invariant qui garantit la non-expiration ; toute évolution du schéma doit le préserver.
- La confidentialité des messages privés repose sur un filtrage serveur (rooms ciblées + filtre REST par perspective) — le frontend ne peut jamais recevoir les privés d'autrui.
- Le frontend maintient un cache local des messages TTL 10 h (miroir du backend) et un cache d'avatar scoping par compte et par table (`food_ychat_avatar_<userId>_<tableId>`).

## Écran d'accueil yChat (visiteur non connecté)

**Contexte** : le QR est imprimé sur la table et peut être scanné par un client qui n'est pas encore connecté. L'ancien `AuthGuard` renvoyait immédiatement vers `/login` : le visiteur ne voyait ni le restaurant ni le contexte du QR.

**Décision** :
- La route `/restaurant/yChat` est **publique** (plus d'`AuthGuard`) ; l'authentification est exigée au niveau des actions (socket, avatars, messages), pas de l'affichage.
- Nouvel endpoint **public** `GET /chat/positions/by-qr/:idQr/public` (aucune session) : projection minimale `{ position: { _id, label }, restaurantId, restaurant: { _id, name, slug, status, logo } | null }`. Aucun `idQr`, `tableId` ni champ interne du siège n'est exposé ; 404 si le QR est inconnu ou révoqué (position inactive). Le restaurant n'est retourné que s'il est actif (sa fiche est déjà publique via `GET /restaurants/:id`).
- Le resolver choisit l'endpoint selon la session : `auth.isLoggedIn()` → résolution authentifiée complète (`position + tableId + restaurant`) ; sinon → résolution publique et `YChatData.authenticated = false`.
- La page affiche `YChatWelcomeComponent` (logo + nom du restaurant, message de bienvenue, siège scanné, bouton « Se connecter pour continuer ») et **n'ouvre aucun socket** tant que le visiteur n'est pas connecté.
- Le bouton utilise `AuthService.redirectToLogin()` → `/login?returnUrl=/restaurant/yChat?idQr=…` ; après connexion, `LoginComponent` valide le `returnUrl` same-origin et revient sur le chat, où le resolver rejoue le flux complet.

**Sécurité** : l'endpoint public ne révèle rien qui ne soit déjà accessible avec le QR imprimé ; l'énumération est empêchée par l'`idQr` aléatoire (72 bits) ; les données de chat restent protégées par `JwtAuthGuard` + validation d'appartenance de l'avatar.
