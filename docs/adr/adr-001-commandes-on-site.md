# ADR-001 — Commandes on-site (commande prise à table par le staff)

- **Statut** : accepté
- **Date** : 2026-11-25
- **Phase** : 1 du plan `docs/plans/plan-onsite-ychat.md`

## Contexte

Les restaurants partenaires souhaitent prendre les commandes directement à table : le personnel saisit la commande sur l'app, le client paie sur place via mobile money, aucune livraison n'est impliquée. Le modèle existant n'acceptait que des commandes `delivery` (zone de livraison, frais de livraison, packaging, frais de plateforme, adresse obligatoire) créées par le client lui-même.

Contraintes :
- un produit peut ne pas être vendable sur place (ex. préparé uniquement pour la livraison) ;
- le personnel (admin/manager/employee) doit pouvoir créer et payer au nom du client de table, qui n'a pas de compte rattaché ;
- le montant encaissé doit être intégralement reversé au restaurant via la répartition de fonds existante (version 3).

## Décision

**Nouveau type de commande `on_site`** créé par le personnel via `POST /api/orders/on-site` (`src/modules/orders/orders.controller.ts` → `OrdersService.createOnSite`) :

- `orderType: 'on_site'` (enum `['delivery', 'on_site']` dans `order.schema.ts`, défaut `delivery`) ; `tableLabel` et `notes` optionnels ; `order.userId` = l'acteur staff (le client de table n'a pas de compte rattaché à la commande).
- **Rôles** : `ADMIN`, `MANAGER`, `EMPLOYEE` (défense en profondeur dans le service en plus du `@Roles`). Manager/employé sont forcés à leur propre restaurant ; l'admin peut créer pour n'importe quel restaurant.
- **Tous les frais à zéro** (`calculateOnSite`) : `packagingTotal`, `deliveryFee`, `platformFee`, `promoDiscount`, `categorySystemFeeTotal` = 0 → `paymentAmount = grandTotal = itemsSubtotal`, avec `balanceDistributionVersion: 3`. La répartition v3 existante crédite donc 100 % du montant encaissé au restaurant.
- **Filtrage canal** : les `MenuItem` portent `onSite` / `onDelivery` (booléens, défaut `true`). Un item avec `onSite: false` est traité comme indisponible pour une commande on-site (erreur structurée `INSUFFICIENT_STOCK`). L'endpoint public de menu accepte `onSite=true|false` avec des filtres défensifs (`$ne: false` / `$ne: true`) pour couvrir les documents non backfillés (champ absent = vendable sur place).
- **Paiement** : réutilise le direct charge DigiKuntz existant `POST /api/payments/initiate-direct/:orderId`, initié par le staff. `assertDirectChargeOwner` autorise le personnel (admin : toujours ; manager/employee : commande on-site de leur restaurant). Pour une commande `on_site` initiée par le staff, **le numéro Mobile Money du client est requis** (`PAYMENT_PHONE_MISSING`, message « Numéro du client requis ») : aucun fallback sur le téléphone du profil courant, qui est celui du staff — `order.userId` étant le créateur staff, le fallback enverrait la demande de confirmation sur le mauvais téléphone.
- Même fenêtre de service que la livraison (`assertOrderingOpen`), transaction Mongo, réservation de stock et journal d'audit (`order.create_on_site`) identiques au parcours livraison.

## Alternatives considérées

- **Paiement comptoir hors plateforme** (cash ou encaissement direct du restaurant) : rejeté — aucune traçabilité, aucune répartition v3, montants invisibles dans l'app pour le restaurant et l'admin.
- **Client paie lui-même** (le client scanne le QR, commande et paie depuis son téléphone) : rejeté pour cette phase — suppose un compte client connecté et une création de commande par le client ; la phase 1 cible la prise de commande par le staff. Règle associée conservée : le paiement direct d'une commande on-site exige le numéro du client, pas celui du staff.

## Conséquences

- **Backfill obligatoire avant déploiement** : les defaults Mongoose (`onSite: true`, `onDelivery: true`) ne s'appliquent qu'aux documents créés après l'ajout des champs. Exécuter `npm run backfill:menu-channels` (dry-run par défaut, `-- --apply` pour appliquer) — script idempotent (`src/scripts/backfill-menu-item-channels.ts`) qui met à niveau tous les `MenuItem` existants sans écraser une valeur `false` explicite.
- **`deliveryAddress` devient optionnel au schéma** (`default: null`) : il n'est plus imposé à toute commande, mais reste obligatoire dans le parcours delivery (validation métier inchangée).
- Le frontend réutilise le composant partagé `app-direct-payment` avec `[onSite]="true"` : champ téléphone vide et placeholder « Numéro du client » (le téléphone du profil courant n'est pas prérempli, il est celui du staff).
- Les commandes on-site suivent le workflow de paiement standard (`PENDING_PAYMENT` → `paid` via webhook/cron) ; aucun statut de livraison ne leur est applicable.
