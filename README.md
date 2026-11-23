# Food Delivery Backend

## Setup
```bash
cp .env.example .env
npm install
npm run seed:admin
npm run start:dev
```

## CORS
- Configure `FRONTEND_URL` (URL exacte du site Angular, sans `/` final).
- Ajoutez d'autres origines via `CORS_ORIGINS` (séparées par des virgules), par ex. `https://www.eat.yaba-in.com`.
- En **production** (`NODE_ENV=production`), au moins une de ces variables est **obligatoire**.
- En **développement**, `http://localhost:4200` et `http://localhost:5173` sont autorisés par défaut en plus des variables d'environnement.
- Les cookies refresh (`credentials: true`) exigent une liste blanche stricte — pas de `*`.

## Variables d'environnement

La référence exhaustive et copiable est [`.env.example`](./.env.example). Le tableau ci-dessous recense **toutes** les variables lues par le code, avec leur caractère obligatoire et leur valeur par défaut.

### Serveur
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `NODE_ENV` | non | `development` | `production` active les règles CORS strictes et résout `UPLOAD_DIR`. |
| `PORT` | non | `3000` | Port HTTP du backend. |
| `APP_URL` | oui pour les uploads | — | URL publique du backend, utilisée pour construire les URLs absolues des fichiers uploadés. |
| `INSTANCE_ID` | non | `HOSTNAME` | Identifiant d'instance pour les leases de cron multi-instances. |

### Base de données
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `MONGODB_URI` | **oui** | — | Chaîne de connexion MongoDB/Mongoose. |

### Authentification et chiffrement
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `JWT_SECRET` | **oui** | — | Signature des JWT (access token, expiration 90 j). |
| `JWT_REFRESH_SECRET` | non | — | **Non utilisé actuellement** (les tokens utilisent `JWT_SECRET`) ; conservé pour compatibilité. |
| `GOOGLE_CLIENT_ID` | non | — | Doit être identique au `googleClientId` du frontend. |
| `ENCRYPTION_KEY` | non | `JWT_SECRET`, sinon `eat-app-default-key` | Chiffrement des mots de passe stockés en base. |
| `TERMS_VERSION` | non | `v1.0` | Version des CGU acceptée par défaut à l'inscription. |

### CORS
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `FRONTEND_URL` | **oui en production** | `http://localhost:4200` en dev | URL exacte du frontend (sans `/` final) ; sert aussi aux liens email/WhatsApp. |
| `CORS_ORIGINS` | non | — | Origines supplémentaires séparées par des virgules. |

### Emails
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `SMTP_HOST` | non | — | Serveur SMTP. Si incomplet, les emails sont ignorés avec un warning. |
| `SMTP_PORT` | non | `587` (le `.env` local utilise `465` en SSL) | Port SMTP. |
| `SMTP_USER` | non | — | Identifiant SMTP. |
| `SMTP_PASS` | non | — | Mot de passe / mot de passe d'application SMTP. |
| `RESET_PASSWORD_PATH` | non | `/reset-password` | Chemin frontend du lien de réinitialisation. |

### Paiement mobile money (DigiKuntz)
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `DIGIKUNTZ_BASE_URL` | **oui** pour payer | — | URL de base de l'API DigiKuntz. |
| `DIGIKUNTZ_USER_ID` | **oui** pour payer | — | Identifiant fournisseur. |
| `DIGIKUNTZ_API_KEY` | **oui** pour payer | — | Clé API fournisseur (secret). |
| `DIGIKUNTZ_WEBHOOK_SECRET` | **oui** pour payer | — | Secret de validation du webhook. |
| `DIGIKUNTZ_REQUEST_TIMEOUT_MS` | non | `12000` | Timeout d'un appel HTTP DigiKuntz. |
| `DIGIKUNTZ_GATEWAY_TIMEOUT_MS` | non | `3600000` | Timeout avant alerte/réconciliation d'un retrait gateway indisponible. |
| `DIGIKUNTZ_DIRECT_CHARGE_TIMEOUT_MS` | non | `20000` | Timeout du direct charge (push opérateur). |
| `DIGIKUNTZ_RETRY_INTERVAL_MS` | non | `60000` | Intervalle minimal entre deux tentatives de payout. |
| `DIGIKUNTZ_IDEMPOTENCY_TTL_MS` | non | `82800000` (23 h) | TTL d'idempotence ; plafonnée à 23 h, strictement sous les 24 h du provider. |
| `PAYMENT_UNKNOWN_RETRY_COOLDOWN_SECONDS` | non | `60` | Délai minimal avant de renvoyer la même demande après une issue inconnue. |
| `PAYMENT_UNKNOWN_HOLD_MINUTES` | non | `30` | Rétention maximale d'une commande dont le direct charge est `unknown`. |
| `PAYMENT_DIRECT_CALLING_HOLD_MINUTES` | non | `2` | Rétention maximale d'un appel direct `calling`. |
| `MIN_WITHDRAWAL_AMOUNT_XAF` | non | `1000` | Solde strictement supérieur requis pour le retrait auto restaurant. |
| `MOBILE_MONEY_USSD_ORANGE` | non | `#150*50#` | Code USSD Orange affiché ; vide = aucun code. |
| `MOBILE_MONEY_USSD_MTN` | non | `*126#` | Code USSD MTN affiché ; vide = aucun code. |

### Commandes et répartition
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `ORDER_PAYMENT_TIMEOUT_MINUTES` | non | `30` | TTL d'une commande en attente de paiement et fenêtre du lien hébergé. |
| `PAYMENT_TIMEOUT_MINUTES` | non | — | Alias legacy de `ORDER_PAYMENT_TIMEOUT_MINUTES` (utilisé seulement si celui-ci est absent). |
| `PAYMENT_HOSTED_FALLBACK_TIMEOUT_MINUTES` | non | `30` | Durée d'ouverture du lien hébergé après un direct charge refusé. |
| `PLATFORM_FEE_TYPE` | non | `fixed` | `fixed` ou `percentage`. |
| `PLATFORM_FEE_VALUE` | non | `0` | Montant ou pourcentage du frais de plateforme. |

### Batchs et verrous (exploitation)
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `PAYMENT_STATUS_SYNC_SECONDS` | non | `10` (min 1) | Throttle du rafraîchissement du statut provider. |
| `PAYMENT_INITIATION_LOCK_SECONDS` | non | `300` | Verrou anti-course sur l'initiation d'un paiement. |
| `PAYMENT_EXPIRY_BATCH_LIMIT` | non | `200` | Commandes expirées traitées par passage de cron. |
| `DIGIKUNTZ_SYNC_BATCH_LIMIT` | non | `100` | Paiements/retraits synchronisés par passage de cron. |
| `BALANCE_RECONCILIATION_BATCH_LIMIT` | non | `100` | Transactions de balance réconciliées par passage de cron. |

### Fichiers
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `STORAGE_DRIVER` | non | `local` | Seul `local` est supporté actuellement. |
| `UPLOAD_DIR_LOCAL` | non | `uploads` | Dossier d'uploads en développement. |
| `UPLOAD_DIR` | non (prod) | `/home/u505661520/public_html/uploads` | Dossier absolu d'uploads en production. |

### WhatsApp
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `WHATSAPP_AUTO_INIT` | non | `true` | Initialise automatiquement le client whatsapp-web.js. |
| `WHATSAPP_SESSION_DIR` | non | `whatsapp-session` | Dossier de session à conserver entre redéploiements. |
| `WHATSAPP_GATEWAY_URL` | non | — | URL de la passerelle HTTP (prioritaire sur le mode local si `WHATSAPP_LOCAL_ENABLED != true`). |
| `WHATSAPP_GATEWAY_PASSWORD` | non | `123Whatsapp?` | Mot de passe de la passerelle. |
| `WHATSAPP_LOCAL_ENABLED` | non | `false` | `true` = client local whatsapp-web.js au lieu de la passerelle. |
| `WHATSAPP_READY_TIMEOUT_MS` | non | `90000` | Délai d'attente avant que le client soit prêt. |

### Merlin IA (OpenRouter)
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `MERLIN_ENABLED` | non | `true` | Active/désactive l'assistant. |
| `MERLIN_API_KEY` | oui si Merlin activé | — | Clé OpenRouter. |
| `MERLIN_BASE_URL` | non | `https://openrouter.ai/api/v1` | URL de base OpenRouter. |
| `MERLIN_MODELS` | non | liste de 5 modèles | Modèles candidats, séparés par des virgules (5 max). |
| `MERLIN_MODEL` | non | — | Alias legacy de `MERLIN_MODELS` (un seul modèle). |
| `MERLIN_MODEL_STRATEGY` | non | `fallback` | `fallback` ou `round-robin`. |
| `MERLIN_TEMPERATURE` | non | `0.7` | Température de génération. |
| `MERLIN_REASONING_EFFORT` | non | `low` | Effort de raisonnement. |
| `MERLIN_TIMEOUT_MS` | non | `90000` | Timeout d'un appel Merlin. |
| `MERLIN_CONTEXT_MESSAGES` | non | `10` | Messages de contexte réinjectés. |
| `MERLIN_MAX_HISTORY` | non | `50` | Historique max conservé par conversation. |
| `MERLIN_CRON_TIMEZONE` | non | `Africa/Douala` | Fuseau des purges/crons Merlin. |

### Annonces
| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `ANNOUNCEMENT_DELIVERY_MAX_ATTEMPTS` | non | `3` | Nombre max de tentatives par destinataire. |
| `ANNOUNCEMENT_DELIVERY_LOCK_TIMEOUT_MINUTES` | non | `10` | Délai avant reprise d'une livraison bloquée en `processing`. |
| `ANNOUNCEMENT_EMAIL_BATCH_SIZE` | non | — | **Non utilisé par le code actuel** (legacy). |
| `ANNOUNCEMENT_WHATSAPP_BATCH_SIZE` | non | — | **Non utilisé par le code actuel** (legacy). |

> Variables présentes dans certains `.env` locaux mais **non lues par le code** : `WABA_PHONE_ID`, `WABA_TOKEN` (ancienne API WhatsApp Cloud) et `PUPPETEER_CACHE_DIR` (configuration de l'outil Puppeteer, pas une variable applicative).

## Default admin
- email: `admin@example.com`
- password: `Admin@12345`

## Paiement mobile money (DigiKuntz)

### Configuration
- Les identifiants `DIGIKUNTZ_*` sont obligatoires pour encaisser des paiements ; les autres variables de paiement ont des valeurs par défaut.
- Voir la section [Variables d'environnement](#variables-denvironnement) pour la liste complète et les valeurs par défaut.
- Les valeurs contenant `#` doivent être entre guillemets dans `.env`.

### Endpoints
- `POST /api/payments/initiate-direct/:orderId` : **client propriétaire uniquement**. Body optionnel `{ phone?, paymentMethodCode? }` : le frontend envoie le numéro **local 9 chiffres** prérempli et le réseau sélectionné ; le backend revalide la cohérence (sinon `PAYMENT_OPERATOR_MISMATCH`). La requête provider est alignée sur le format de référence : `estimation`, `currency: XAF`, `userPhone` 9 chiffres, `senderName`, `raisonForTransfer`, header `Idempotency-Key` ; **pas** de `paymentMethodCode` ni de `callbackUrl` (routing provider par le numéro). Réponse `201` : `outcome` = `prompt_sent` (demande envoyée, `ussdCode` fourni) ou `refused` (DigiKuntz refuse le direct : ouvrir `paymentLink`, lien hébergé https). Codes d'erreur : `PAYMENT_PHONE_MISSING`, `PAYMENT_PHONE_INVALID`, `PAYMENT_OPERATOR_MISMATCH`, `PAYMENT_OPERATOR_UNSUPPORTED`, `PAYMENT_METHOD_UNAVAILABLE`, `PAYMENT_AMOUNT_OUT_OF_RANGE`, `PAYMENT_LIMIT_EXCEEDED`, `PAYMENT_REJECTED`, `PAYMENT_DIRECT_DISABLED`, `PAYMENT_IN_PROGRESS`, `PAYMENT_OUTCOME_UNKNOWN`, `INSUFFICIENT_STOCK`.
  - `PAYMENT_OUTCOME_UNKNOWN` (timeout/5xx sans référence) : le Payment reste `processing`. Le client peut **renvoyer la même demande** (même Payment, même `Idempotency-Key`) après `PAYMENT_UNKNOWN_RETRY_COOLDOWN_SECONDS` (60 s par défaut) : aucun double débit possible. Le timeout provider du direct charge est `DIGIKUNTZ_DIRECT_CHARGE_TIMEOUT_MS` (20 s par défaut).
- `POST /api/payments/initiate/:orderId` : paiement hébergé (page sécurisée), disponible pour le staff et pour les clients (voie de secours).
  - `409 PAYMENT_OUTCOME_UNKNOWN` : DigiKuntz n'a pas répondu de façon certaine, la demande a peut-être été reçue. **Ne pas relancer** : le paiement reste en attente de vérification (la commande n'est ni relancée ni expirée automatiquement).
  - `409 PAYMENT_IN_PROGRESS` : un paiement direct est déjà en cours sur la commande. Confirmer la demande sur le téléphone avant de relancer.
- `GET /api/payments/:orderId/status` : vue client du dernier paiement (`id`, `status`, `amount`, `outcome`, `operator`, `paymentLink` si valide, dates). Aucune donnée fournisseur (`callbackPayload`, `providerRef`, `transactionRef`) n'est renvoyée.
- `POST /api/payments/:id/resolve` : **administrateur**. Force l'issue d'un paiement ambigu (`outcome` = `paid` ou `failed`) via le même chemin atomique que le webhook, avec journal d'audit. Refuse une transition déjà appliquée.

### Répartition des fonds (version 3)
À partir de `balanceDistributionVersion = 3`, le frais de plateforme est réellement encaissé et réparti :
- `paymentAmount` (montant débité) = items + packaging + livraison − promo + `platformFee` ; `grandTotal = paymentAmount`.
- Restaurant : `items + packaging − promo − Σ(frais catégorie)`.
- Livreur : `livraison − 15 %` (le système absorbe le reliquat d'arrondi).
- Système : `Σ(frais catégorie) + 15 % livraison + platformFee`.
- La somme des trois parts est **exactement** égale au montant encaissé.

Les commandes historiques (`balanceDistributionVersion` 1 ou 2) conservent leur règle d'origine : le `platformFee` n'y était pas encaissé, il n'est donc pas crédité. La répartition est centralisée dans `src/modules/payments/utils/order-balance-distribution.util.ts`.

Le paiement canonique d'une commande est figé dans `order.paidPaymentId` : même si plusieurs tentatives atteignent `PAID`, une seule répartition est créditée. La part livreur est rattachée au paiement (pas au livreur), donc une réaffectation après crédit ne double pas la rémunération. La répartition est aussi idempotente **par commande** : les lignes existantes (`order_*_share`) sont détectées avant tout nouveau crédit, ce qui couvre les commandes historiques sans `paidPaymentId`.

⚠️ Déploiement : la version 3 doit être déployée sur **toutes** les instances backend avant qu'une commande v3 puisse être payée. Une instance ancienne interprète une commande v3 comme v2 et omettrait le `platformFee` du crédit système (irréversible à cause de `$setOnInsert`). Déployer de façon atomique (toutes les instances redémarrées) et vérifier qu'aucune commande v3 n'a été payée pendant la fenêtre de déploiement.

Le tableau de bord utilise désormais le montant réellement encaissé (`paymentAmount`, avec repli `grandTotal − platformFee` pour les commandes antérieures) et ne compte le `platformFee` que pour les commandes v3.

Réconciliation : `driverShareSettledAt` marque une commande livrée dont la part livreur a été réglée (ou constatée nulle), ce qui permet au cron de traiter le backlog sans rescanner les mêmes commandes. Une répartition incohérente (somme des parts ≠ montant encaissé, ou snapshot v3 incomplet) est refusée et la commande est marquée `settlementError = inconsistent_distribution` : elle sort des crons et nécessite une correction manuelle, afin de ne jamais créditer plus que le montant encaissé.

### Ordre d'affichage des catégories
- `Category.order` est un entier global (0 = premier). Les listes `/api/categories` sont triées par `order` puis `createdAt`, donc l'ordre s'applique à l'admin, aux menus manager et aux pages publiques.
- `PATCH /api/categories/:id/move` (**admin**) avec `{ "direction": "up" | "down" }` : normalise l'ordre complet (0..n-1) puis échange la catégorie avec sa voisine. Les nouvelles catégories sont ajoutées à la fin.

### Retrait automatique restaurant
- `PATCH /api/restaurants/my/auto-withdrawal` (**manager uniquement**) : `{ enabled, phone?, accountBankCode? }`. Le numéro est normalisé en 9 chiffres et doit correspondre au réseau (`ORANGEMONEY` ou `MTN`), sinon `400`.
- La configuration est stockée dans `Restaurant.autoWithdrawal` et visible dans `GET /api/restaurants/my`.
- Cron quotidien **00:30 Africa/Douala** : pour chaque restaurant actif avec `enabled`, si le solde disponible est **strictement supérieur** à `MIN_WITHDRAWAL_AMOUNT_XAF` (défaut `1000`) et qu'aucun retrait n'est déjà `pending`/`approved`/`gateway_unavailable`, le système initie un retrait de **la totalité du solde** avec le numéro/réseau configurés.
- Clé d'idempotence quotidienne `auto-<restaurantId>-<YYYY-MM-DD>` : un second passage le même jour ne crée pas un doublon.

### Sécurité des retraits (payouts)
- Le retrait et son débit de solde sont **persistés dans une transaction Mongo avant l'appel à DigiKuntz**. Un payout accepté ne peut plus exister sans trace locale ni débit.
- Idempotence : `POST /api/balances/withdrawals` accepte une `idempotencyKey` optionnelle. Sans clé, le serveur génère une clé déterministe par minute (`svc:<sha256>`), et un index unique `{requestedBy, idempotencyKey}` empêche tout doublon concurrent. Réutiliser une clé avec un montant/numéro périmètre différents renvoie `409`. Tant qu'un retrait identique est non résolu (`pending`/`gateway_unavailable`/`approved`), une nouvelle demande sans clé renvoie ce retrait au lieu d'en créer un second.
- Un refus provider explicite (4xx) passe le retrait en `failed`, rembourse le solde (une seule fois) et renvoie `400`. En cas d'indisponibilité du gateway, le retrait reste `gateway_unavailable` et le cron le reprend avec la même clé d'idempotence provider (`withdrawalId`).
- Au timeout d'1 h, l'état provider est vérifié une dernière fois. Un payout finalement accepté est résolu (`pending`/`paid`). Si le provider ne peut pas confirmer (injoignable ou sans référence), **aucun remboursement automatique n'est effectué** : les fonds restent retenus (`gateway_unavailable`, `providerStatus = unverified_timeout`) pour réconciliation manuelle. C'est volontaire : rembourser un payout dont la réponse a été perdue créerait une double sortie d'argent.
- Un succès provider tardif sur un retrait déjà `failed`/`rejected` n'est **pas** appliqué automatiquement : il est journalisé (`lateProviderSuccessAt`, log niveau error) et reste visible via la liste admin des retraits pour réconciliation manuelle, afin d'éviter un payout + refund non compensés.
- Un retrait `gateway_unavailable` non confirmé reste volontairement retenu (fonds non remboursés) et est re-testé avec un backoff (15 min après un timeout non confirmé). Une **alerte email/WhatsApp** est envoyée aux admins lors du premier passage en `unverified_timeout`, au dépassement de la TTL d'idempotence, et lors d'un succès provider tardif. Après vérification auprès du provider, un administrateur peut le passer manuellement à `failed` (remboursement) ou `paid`.
- Les retraits nécessitant une action manuelle sont listés par `GET /api/balances/admin/withdrawals/reconciliation` (admin) : `unverified_timeout`, `idempotency_in_progress`, `manual_reconciliation_required`, ou succès provider tardif (`lateProviderSuccessAt`).
- Tant qu'un retrait identique (même montant + numéro) reste non résolu, une demande sans clé renvoie ce retrait. Un client qui doit légitimement répéter le même montant/numéro dans cet intervalle doit fournir une `idempotencyKey` distincte.
- Conformité DigiKuntz : `Idempotency-Key` est envoyé **en header** sur `/dev/transaction`, `/dev/direct-charge` et `/dev/payout` (255 caractères max). Un `409` non explicitement métier (ou dont le code structuré indique une idempotence en cours) est traité comme ambigu : aucun remboursement, aucun nouveau paiement. La TTL provider est de 24 h ; notre arrêt de sécurité est fixé à **23 h par défaut et plafonné à 23 h** (`DIGIKUNTZ_IDEMPOTENCY_TTL_MS`), puis réconciliation manuelle.

### Notifications « produit de nouveau disponible »
- Le reset de minuit (`0 0 * * *`, `Africa/Douala`) remet à `0` le stock des catégories configurées (`resetStockAtMidnight=true`) et passe `isAvailable` à `false`.
- Quand un menu item passe de **non vendable** (`stock = 0`, `isAvailable = false` ou `isActive = false`) à **vendable** (`stock > 0`, `isAvailable = true`, `isActive = true`), les utilisateurs qui l'ont en favori reçoivent une notification email/WhatsApp.
- Une simple augmentation de stock sur un produit déjà disponible (`5 → 10`) ne déclenche **aucune** notification.
- Après une rupture (`stock = 0`), un réapprovisionnement recrée une disponibilité et déclenche de nouveau la notification : c'est le comportement attendu pour les produits consommés puis réapprovisionnés dans la journée.
- Le déclenchement est journalisé : `Menu item "..." (...) became available (stock X -> Y); notifying favorites.` Les échecs d'envoi sont journalisés par `NotificationsService` (`Unable to send email...`, `Unable to send WhatsApp...`).

### Expiration des commandes impayées
- Une commande `PENDING_PAYMENT` est expirée après `ORDER_PAYMENT_TIMEOUT_MINUTES` (30 min) et son stock est restitué si elle date du jour courant au Cameroun.
- Un direct charge `calling` est retenu au maximum `PAYMENT_DIRECT_CALLING_HOLD_MINUTES` (2 min), un `unknown` au maximum `PAYMENT_UNKNOWN_HOLD_MINUTES` (30 min), un `prompt_sent` au maximum le TTL commande. Au-delà, la commande expire ; un succès provider tardif peut encore la récupérer et re-réserver le stock.
- Une commande plus ancienne que la fenêtre de paiement n'est plus payable : `POST /payments/initiate*` renvoie `PAYMENT_EXPIRED`, et le bouton « Payer maintenant » n'est plus affiché côté client.

### Règles de sécurité des paiements
- Une demande directe `prompt_sent` encore `processing` n'est jamais expirée automatiquement : la synchronisation DigiKuntz la résout en `payin_success`, `payin_error` ou `payin_closed`.
- Un direct charge refusé avec `paymentLink` reste une transaction ouverte chez DigiKuntz (`payin_pending`) : la commande n'est pas expirée et le stock n'est pas libéré pendant la fenêtre `PAYMENT_HOSTED_FALLBACK_TIMEOUT_MINUTES`.
- Un paiement dont l'issue est inconnue (`unknown`) n'est jamais supprimé, libéré ni relancé automatiquement.
- Les transitions terminales sont appliquées par claim atomique : un webhook et le cron concurrents ne peuvent ni créditer deux fois ni restituer deux fois le stock.
- Si DigiKuntz est indisponible au moment de l'expiration, la commande reste ouverte (fail-closed) au lieu d'être annulée à tort.
- Un succès reçu après expiration re-réserve le stock ; s'il est insuffisant, la commande est marquée `paid_without_stock` (remboursement manuel, aucun crédit restaurant).
- Une commande `payment_failed` peut être repayée en direct uniquement si le stock est encore disponible : le stock est réservé à nouveau dans la même transaction que la reprise de la commande (`409 INSUFFICIENT_STOCK` sinon).

## Notes
- Payments are wired through a DigiKuntz adapter with a mock initiation response.
- Webhook endpoint: `POST /api/payments/webhook/digikuntz`
- Cache HTTP : les réponses `/api` sont envoyées avec `Cache-Control: no-store` (données dynamiques : stock, images, commandes). Si un reverse proxy (Apache/Hostinger, LiteSpeed, CDN) ajoute un `max-age` long, le retirer pour `/api` ; réserver le cache long aux fichiers `/uploads/...`, dont les noms sont uniques et immuables.
- Swagger docs: `GET /api/docs`
- Google sign-in:
  - Add `GOOGLE_CLIENT_ID` to `.env`.
  - Client sends the Google ID token to `POST /api/auth/google`.
  - If the response contains `requiresProfileCompletion: true`, call `POST /api/auth/complete-profile` with the returned bearer token and the missing fields listed in `missingProfileFields`.
- Password reset:
  - `POST /api/auth/forgot-password` with `email` sends a reset link by email.
  - `POST /api/auth/reset-password` with `token` + `newPassword` updates the password.
  - Reset token expiration is fixed to 1 hour.
- Upload endpoints:
  - `POST /api/uploads` with form-data file field `file`
  - `POST /api/uploads/:folder` with form-data file field `file`
  - Les images (produits, logos, bannières, profils, catégories et pièces jointes d'annonces) sont converties en WebP (qualité 82). Formats acceptés : JPEG, PNG, WebP, GIF, AVIF, TIFF, HEIC/HEIF. SVG, BMP et ICO sont refusés (400/415). Si `sharp` échoue, l'upload est refusé (400), le fichier temporaire et l'original sont supprimés. Les PDF/Word/Excel des annonces ne sont pas convertis.
  - GIF animés : conservés en WebP animé (maximum 30 images et 16 MP cumulés). Les images statiques sont limitées à 25 MP. L'orientation EXIF est appliquée à tous les formats.
  - Annonces WhatsApp : la passerelle doit accepter `image/webp` ; sinon, prévoir un dérivé JPEG avant l'envoi.
- Restaurants (admin):
  - `POST /api/restaurants/:id/assign-manager`
  - `PATCH /api/restaurants/:id/media` (logo + bannerImage)
  - `PATCH /api/restaurants/:id/logo/upload` (multipart `file`)
  - `PATCH /api/restaurants/:id/banner/upload` (multipart `file`)
- User profile image:
  - `GET /api/users/me/profile-image`
  - `PATCH /api/users/me/profile-image`
  - `PATCH /api/users/me/profile-image/upload` (multipart `file`)
  - `DELETE /api/users/me/profile-image`
- User activation (admin):
  - `PATCH /api/users/:id/activate`
  - `PATCH /api/users/:id/deactivate`
- Cart endpoints (authenticated user):
  - `GET /api/cart`
  - `POST /api/cart/items`
  - `PATCH /api/cart/items/:menuItemId`
  - `DELETE /api/cart/items/:menuItemId`
  - `DELETE /api/cart`
- Order from cart:
  - `POST /api/orders/preview-from-cart`
  - `POST /api/orders/from-cart`
