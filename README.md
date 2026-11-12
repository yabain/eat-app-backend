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

## Default admin
- email: `admin@example.com`
- password: `Admin@12345`

## Paiement mobile money (DigiKuntz)

### Variables d'environnement
- `DIGIKUNTZ_BASE_URL`, `DIGIKUNTZ_USER_ID`, `DIGIKUNTZ_API_KEY`, `DIGIKUNTZ_WEBHOOK_SECRET` : identifiants fournisseur (secrets, jamais exposés au client).
- `DIGIKUNTZ_REQUEST_TIMEOUT_MS` : délai maximal d'un appel DigiKuntz (défaut `12000`). Au-delà, l'issue est considérée comme inconnue.
- `MOBILE_MONEY_USSD_ORANGE` : code USSD de confirmation Orange affiché au client (défaut `#150*50#`). Variable vide : aucun code affiché.
- `MOBILE_MONEY_USSD_MTN` : code USSD de confirmation MTN affiché au client (défaut `*126#`). Variable vide : aucun code affiché.
- `PAYMENT_HOSTED_FALLBACK_TIMEOUT_MINUTES` : durée pendant laquelle une commande dont le direct charge a été refusé avec lien hébergé reste ouverte (défaut `30`). DigiKuntz garde la transaction en `payin_pending` : le stock n'est pas libéré tant que ce lien peut encore être payé. La fenêtre est mesurée depuis la tentative de paiement, pas depuis la création de la commande.
- `ORDER_PAYMENT_TIMEOUT_MINUTES` : délai au-delà duquel une commande `PENDING_PAYMENT` sans paiement confirmé est annulée et son stock restitué (défaut `30`).
- Les valeurs contenant `#` doivent être entre guillemets dans `.env`.

### Endpoints
- `POST /api/payments/initiate-direct/:orderId` : **client propriétaire uniquement**. Envoie une demande de confirmation sur le téléphone du client (Orange ou MTN, numéro lu côté serveur). Réponse `201` : `outcome` = `prompt_sent` (demande envoyée) ou `refused` (DigiKuntz refuse le direct : ouvrir `paymentLink`, lien hébergé https). Codes d'erreur : `PAYMENT_PHONE_MISSING`, `PAYMENT_PHONE_INVALID`, `PAYMENT_OPERATOR_UNSUPPORTED`, `PAYMENT_METHOD_UNAVAILABLE`, `PAYMENT_AMOUNT_OUT_OF_RANGE`, `PAYMENT_LIMIT_EXCEEDED`, `PAYMENT_REJECTED`, `PAYMENT_DIRECT_DISABLED`, `PAYMENT_IN_PROGRESS`, `PAYMENT_OUTCOME_UNKNOWN`, `INSUFFICIENT_STOCK`.
- `POST /api/payments/initiate/:orderId` : paiement hébergé (page sécurisée), disponible pour le staff et pour les clients (voie de secours).
  - `409 PAYMENT_OUTCOME_UNKNOWN` : DigiKuntz n'a pas répondu de façon certaine, la demande a peut-être été reçue. **Ne pas relancer** : le paiement reste en attente de vérification (la commande n'est ni relancée ni expirée automatiquement).
  - `409 PAYMENT_IN_PROGRESS` : un paiement direct est déjà en cours sur la commande. Confirmer la demande sur le téléphone avant de relancer.
- `GET /api/payments/:orderId/status` : vue client du dernier paiement (`id`, `status`, `amount`, `outcome`, `operator`, `paymentLink` si valide, dates). Aucune donnée fournisseur (`callbackPayload`, `providerRef`, `transactionRef`) n'est renvoyée.
- `POST /api/payments/:id/resolve` : **administrateur**. Force l'issue d'un paiement ambigu (`outcome` = `paid` ou `failed`) via le même chemin atomique que le webhook, avec journal d'audit. Refuse une transition déjà appliquée.

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
