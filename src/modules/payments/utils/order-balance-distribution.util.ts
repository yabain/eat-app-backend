/**
 * Répartition financière d'une commande payée.
 *
 * Règle métier (version 3) :
 *   restaurant = Σ(items) + packaging − promo − Σ(frais catégorie)
 *   livreur    = deliveryFee − prélèvement livraison (15 %)
 *   système    = Σ(frais catégorie) + prélèvement livraison + platformFee
 *
 * Le reliquat d'arrondi du prélèvement livraison est laissé au système
 * (`deliveryFee - driverAmount`) : la somme des trois parts est donc
 * exactement égale au montant encaissé, sans XAF perdu.
 *
 * Les versions 1 et 2 sont conservées à l'identique pour les commandes
 * historiques : le platformFee n'y était pas encaissé, il ne doit donc pas
 * être crédité.
 */

export interface OrderBalanceDistribution {
  systemAmount: number;
  restaurantAmount: number;
  driverAmount: number;
  distributionVersion: number;
}

export function toMoney(value: any): number {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.floor(amount));
}

/** Montant réellement demandé au prestataire de paiement. */
export function orderPaymentAmount(order: any): number {
  const pricing = order?.pricingSnapshot || {};
  const explicit = Number(pricing.paymentAmount);
  if (Number.isFinite(explicit) && explicit > 0) return toMoney(explicit);

  const version = Number(pricing.balanceDistributionVersion || 1);
  // À partir de la v3, le platformFee est inclus dans le montant encaissé.
  const platformFee = version >= 3 ? Number(pricing.platformFee || 0) : 0;

  const itemsSubtotal = Number(pricing.itemsSubtotal);
  const packagingTotal = Number(pricing.packagingTotal);
  const deliveryFee = Number(pricing.deliveryFee);
  const promoDiscount = Number(pricing.promoDiscount || 0);
  if ([itemsSubtotal, packagingTotal, deliveryFee].every(Number.isFinite)) {
    return toMoney(
      itemsSubtotal + packagingTotal + deliveryFee - promoDiscount + platformFee,
    );
  }

  return toMoney(
    Number(pricing.grandTotal || 0) -
      (version >= 3 ? 0 : Number(pricing.platformFee || 0)),
  );
}

/**
 * Vérifie l'invariant comptable : la somme des trois parts doit être
 * exactement égale au montant encaissé. Un snapshot incomplet ne doit jamais
 * produire un crédit supérieur à ce qui a été collecté.
 */
export function isDistributionBalanced(
  order: any,
  distribution: OrderBalanceDistribution,
): boolean {
  return (
    distribution.restaurantAmount +
      distribution.driverAmount +
      distribution.systemAmount ===
    orderPaymentAmount(order)
  );
}

function categorySystemFeeTotal(order: any, pricing: any): number {
  return toMoney(
    pricing.categorySystemFeeTotal ??
      (order?.items || []).reduce(
        (sum: number, item: any) =>
          sum +
          Number(
            item.systemFeeTotal ??
              Number(item.systemFeePerItem || 0) * Number(item.quantity || 0),
          ),
        0,
      ),
  );
}

export function orderBalanceDistribution(order: any): OrderBalanceDistribution {
  const pricing = order?.pricingSnapshot || {};
  const paymentAmount = orderPaymentAmount(order);
  const deliveryFee = toMoney(pricing.deliveryFee);
  const packagingTotal = toMoney(pricing.packagingTotal);
  const distributionVersion = Number(pricing.balanceDistributionVersion || 1);

  if (distributionVersion >= 3) {
    const itemsSubtotal = toMoney(pricing.itemsSubtotal);
    const promoDiscount = toMoney(pricing.promoDiscount);
    const platformFee = toMoney(pricing.platformFee);
    const categoryFees = categorySystemFeeTotal(order, pricing);

    const driverAmount = toMoney(deliveryFee * 0.85);
    // Le système absorbe le reliquat d'arrondi : plus aucun XAF perdu.
    const systemDeliveryShare = Math.max(0, deliveryFee - driverAmount);

    return {
      systemAmount: toMoney(categoryFees + systemDeliveryShare + platformFee),
      restaurantAmount: toMoney(
        itemsSubtotal + packagingTotal - promoDiscount - categoryFees,
      ),
      driverAmount,
      distributionVersion,
    };
  }

  if (distributionVersion >= 2) {
    const itemsSubtotal = toMoney(pricing.itemsSubtotal);
    const promoDiscount = toMoney(pricing.promoDiscount);
    const categoryFees = categorySystemFeeTotal(order, pricing);
    const driverAmount = toMoney(deliveryFee * 0.85);
    const systemDeliveryShare = toMoney(deliveryFee * 0.15);

    return {
      systemAmount: toMoney(categoryFees + systemDeliveryShare),
      restaurantAmount: toMoney(
        itemsSubtotal + packagingTotal - promoDiscount - categoryFees,
      ),
      driverAmount,
      distributionVersion,
    };
  }

  const driverAmount = toMoney(deliveryFee * 0.75);
  const systemDeliveryShare = Math.max(0, deliveryFee - driverAmount);
  return {
    systemAmount: toMoney(packagingTotal + systemDeliveryShare),
    restaurantAmount: toMoney(paymentAmount - deliveryFee - packagingTotal),
    driverAmount,
    distributionVersion,
  };
}