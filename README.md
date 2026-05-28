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
