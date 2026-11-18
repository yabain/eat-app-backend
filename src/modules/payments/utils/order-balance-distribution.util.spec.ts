import {
  isDistributionBalanced,
  orderBalanceDistribution,
  orderPaymentAmount,
} from './order-balance-distribution.util';

describe('orderBalanceDistribution', () => {
  it('version 3 : répartit le platformFee au système et équilibre exactement le montant encaissé', () => {
    const order = {
      items: [],
      pricingSnapshot: {
        itemsSubtotal: 5000,
        packagingTotal: 400,
        deliveryFee: 1500,
        categorySystemFeeTotal: 300,
        promoDiscount: 0,
        platformFee: 345,
        paymentAmount: 7245,
        grandTotal: 7245,
        balanceDistributionVersion: 3,
      },
    };

    const result = orderBalanceDistribution(order);

    expect(result).toEqual({
      restaurantAmount: 5100,
      driverAmount: 1275,
      systemAmount: 870, // 300 frais catégorie + 225 livraison + 345 plateforme
      distributionVersion: 3,
    });
    expect(
      result.restaurantAmount + result.driverAmount + result.systemAmount,
    ).toBe(order.pricingSnapshot.paymentAmount);
  });

  it('version 3 : le système absorbe le reliquat d’arrondi du prélèvement livraison', () => {
    const order = {
      items: [],
      pricingSnapshot: {
        itemsSubtotal: 1000,
        packagingTotal: 0,
        deliveryFee: 1001,
        categorySystemFeeTotal: 0,
        promoDiscount: 0,
        platformFee: 0,
        paymentAmount: 2001,
        balanceDistributionVersion: 3,
      },
    };

    const result = orderBalanceDistribution(order);

    expect(result.driverAmount).toBe(850); // floor(1001 × 0,85)
    expect(result.systemAmount).toBe(151); // 1001 − 850, reliquat conservé
    expect(result.restaurantAmount).toBe(1000);
    expect(
      result.restaurantAmount + result.driverAmount + result.systemAmount,
    ).toBe(2001);
  });

  it('version 3 : la promotion est portée par le restaurant', () => {
    const order = {
      items: [],
      pricingSnapshot: {
        itemsSubtotal: 5000,
        packagingTotal: 400,
        deliveryFee: 1500,
        categorySystemFeeTotal: 300,
        promoDiscount: 500,
        platformFee: 345,
        paymentAmount: 6745,
        balanceDistributionVersion: 3,
      },
    };

    const result = orderBalanceDistribution(order);

    expect(result.restaurantAmount).toBe(4600);
    expect(result.driverAmount).toBe(1275);
    expect(result.systemAmount).toBe(870);
    expect(
      result.restaurantAmount + result.driverAmount + result.systemAmount,
    ).toBe(6745);
  });

  it('version 3 : reconstruit les frais catégorie depuis les items si le snapshot est incomplet', () => {
    const order = {
      items: [
        { systemFeeTotal: 100, quantity: 1 },
        { systemFeePerItem: 50, quantity: 4 },
      ],
      pricingSnapshot: {
        itemsSubtotal: 3000,
        packagingTotal: 200,
        deliveryFee: 1000,
        promoDiscount: 0,
        platformFee: 210,
        paymentAmount: 4410,
        balanceDistributionVersion: 3,
      },
    };

    const result = orderBalanceDistribution(order);

    // 100 + (50 × 4) = 300 de frais catégorie
    expect(result.systemAmount).toBe(300 + 150 + 210);
    expect(result.restaurantAmount).toBe(3000 + 200 - 300);
    expect(
      result.restaurantAmount + result.driverAmount + result.systemAmount,
    ).toBe(4410);
  });

  it('version 2 : le platformFee n’est pas crédité (il n’était pas encaissé)', () => {
    const order = {
      items: [],
      pricingSnapshot: {
        itemsSubtotal: 5000,
        packagingTotal: 400,
        deliveryFee: 1500,
        categorySystemFeeTotal: 300,
        promoDiscount: 0,
        platformFee: 345,
        paymentAmount: 6900,
        balanceDistributionVersion: 2,
      },
    };

    const result = orderBalanceDistribution(order);

    expect(result).toEqual({
      restaurantAmount: 5100,
      driverAmount: 1275,
      systemAmount: 525,
      distributionVersion: 2,
    });
  });

  it('version 1 : conserve l’ancienne règle (packaging + 25 % livraison au système)', () => {
    const order = {
      items: [],
      pricingSnapshot: {
        itemsSubtotal: 5000,
        packagingTotal: 400,
        deliveryFee: 1500,
        promoDiscount: 0,
        paymentAmount: 6900,
        balanceDistributionVersion: 1,
      },
    };

    const result = orderBalanceDistribution(order);

    expect(result).toEqual({
      restaurantAmount: 5000,
      driverAmount: 1125,
      systemAmount: 775,
      distributionVersion: 1,
    });
    expect(
      result.restaurantAmount + result.driverAmount + result.systemAmount,
    ).toBe(6900);
  });
});

describe('orderPaymentAmount', () => {
  it('renvoie le montant explicite du snapshot', () => {
    expect(
      orderPaymentAmount({ pricingSnapshot: { paymentAmount: 7245, grandTotal: 9999 } }),
    ).toBe(7245);
  });

  it('recalcule depuis les composants si paymentAmount est absent', () => {
    expect(
      orderPaymentAmount({
        pricingSnapshot: {
          itemsSubtotal: 5000,
          packagingTotal: 400,
          deliveryFee: 1500,
          promoDiscount: 500,
        },
      }),
    ).toBe(6400);
  });

  it('retombe sur grandTotal − platformFee pour les très anciens snapshots', () => {
    expect(
      orderPaymentAmount({ pricingSnapshot: { grandTotal: 7245, platformFee: 345 } }),
    ).toBe(6900);
  });

  it('version 3 : le fallback grandTotal inclut le platformFee déjà encaissé', () => {
    expect(
      orderPaymentAmount({
        pricingSnapshot: { grandTotal: 7245, platformFee: 345, balanceDistributionVersion: 3 },
      }),
    ).toBe(7245);
  });

  it('version 3 : le fallback par composants ajoute le platformFee', () => {
    expect(
      orderPaymentAmount({
        pricingSnapshot: {
          itemsSubtotal: 5000,
          packagingTotal: 400,
          deliveryFee: 1500,
          promoDiscount: 0,
          platformFee: 345,
          balanceDistributionVersion: 3,
        },
      }),
    ).toBe(7245);
  });
});

describe('isDistributionBalanced', () => {
  it('valide une répartition v3 exacte', () => {
    const order = {
      items: [],
      pricingSnapshot: {
        itemsSubtotal: 5000,
        packagingTotal: 400,
        deliveryFee: 1500,
        categorySystemFeeTotal: 300,
        promoDiscount: 0,
        platformFee: 345,
        paymentAmount: 7245,
        balanceDistributionVersion: 3,
      },
    };

    expect(isDistributionBalanced(order, orderBalanceDistribution(order))).toBe(true);
  });

  it('détecte un snapshot incomplet qui ne couvre pas le montant encaissé', () => {
    const order = {
      items: [],
      pricingSnapshot: {
        // itemsSubtotal/packagingTotal manquants alors que paymentAmount existe
        deliveryFee: 0,
        categorySystemFeeTotal: 0,
        promoDiscount: 0,
        platformFee: 0,
        paymentAmount: 4200,
        balanceDistributionVersion: 3,
      },
    };

    const distribution = orderBalanceDistribution(order);
    expect(distribution.restaurantAmount + distribution.driverAmount + distribution.systemAmount).toBe(0);
    expect(isDistributionBalanced(order, distribution)).toBe(false);
  });
});