import { config } from 'dotenv';
config();
import * as mongoose from 'mongoose';
import { BalanceTransactionSchema } from '../database/schemas/balance-transaction.schema';
import { PaymentSchema } from '../database/schemas/payment.schema';
import { OrderSchema } from '../database/schemas/order.schema';
import { PaymentStatus } from '../common/enums/payment-status.enum';
import { OrderStatus } from '../common/enums/order-status.enum';

const DRY_RUN = !process.argv.includes('--apply');

function money(value: any): number {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.floor(amount));
}

function computeAmounts(pricing: any, distVersion: number) {
  const deliveryFee = money(pricing.deliveryFee);
  const packagingTotal = money(pricing.packagingTotal);

  if (distVersion >= 2) {
    const itemsSubtotal = money(pricing.itemsSubtotal);
    const promoDiscount = money(pricing.promoDiscount);
    const categorySystemFeeTotal = money(pricing.categorySystemFeeTotal ?? 0);
    const driverAmount = money(deliveryFee * 0.85);
    const systemDeliveryShare = money(deliveryFee * 0.15);

    return {
      systemAmount: money(categorySystemFeeTotal + systemDeliveryShare),
      restaurantAmount: money(itemsSubtotal + packagingTotal - promoDiscount - categorySystemFeeTotal),
      driverAmount,
    };
  }

  const driverAmount = money(deliveryFee * 0.75);
  const systemDeliveryShare = Math.max(0, deliveryFee - driverAmount);
  const paymentAmount =
    money(pricing.paymentAmount) ||
    money(
      money(pricing.itemsSubtotal) + packagingTotal + deliveryFee - money(pricing.promoDiscount),
    );

  return {
    systemAmount: money(packagingTotal + systemDeliveryShare),
    restaurantAmount: money(paymentAmount - deliveryFee - packagingTotal),
    driverAmount,
  };
}

function isDeliveredOrBeyond(orderStatus: string): boolean {
  const deliveredStatuses = [
    OrderStatus.DELIVERED,
    OrderStatus.CLOSED,
  ];
  return deliveredStatuses.includes(orderStatus as OrderStatus);
}

function isPaidOrBeyond(orderStatus: string): boolean {
  const paidStatuses = [
    OrderStatus.PAID,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
    OrderStatus.ASSIGNED,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
    OrderStatus.CLOSED,
    OrderStatus.CANCELLED,
  ];
  return paidStatuses.includes(orderStatus as OrderStatus);
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB (dry-run: ${DRY_RUN})`);

  const BalanceTransaction = mongoose.model('BalanceTransaction', BalanceTransactionSchema);
  const Payment = mongoose.model('Payment', PaymentSchema);
  const Order = mongoose.model('Order', OrderSchema);

  const brokenTransactions = await BalanceTransaction.find({
    reason: /^order_/,
    $or: [
      { amount: { $exists: false } },
      { amount: null },
    ],
  }).lean();

  console.log(`Found ${brokenTransactions.length} broken transaction(s) without amount\n`);

  if (brokenTransactions.length === 0) {
    await mongoose.disconnect();
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const tx of brokenTransactions) {
    let note = '';

    const payment = await Payment.findById(tx.paymentId).lean();
    if (!payment) {
      console.log(`  SKIP tx=${tx._id}: payment ${tx.paymentId} not found`);
      skipped++;
      continue;
    }

    if (payment.status !== PaymentStatus.PAID) {
      console.log(`  SKIP tx=${tx._id}: payment ${payment._id} status is ${payment.status} (not PAID)`);
      skipped++;
      continue;
    }

    const order = await Order.findById(payment.orderId).lean();
    if (!order) {
      console.log(`  SKIP tx=${tx._id}: order ${payment.orderId} not found`);
      skipped++;
      continue;
    }

    const pricing = (order as any).pricingSnapshot || {};
    const distVersion = Number(pricing.balanceDistributionVersion || 1);
    const amounts = computeAmounts(pricing, distVersion);

    let expectedAmount = -1;

    switch (tx.reason) {
      case 'order_system_share': {
        if (!isPaidOrBeyond(order.orderStatus)) {
          console.log(`  SKIP tx=${tx._id} (system): order ${order._id} status is ${order.orderStatus} (not paid)`);
          skipped++;
          continue;
        }
        expectedAmount = amounts.systemAmount;
        note = distVersion >= 2
          ? 'Category flat fees + 15% delivery fee, excluding DigiKuntz platform fees'
          : 'packaging fees + 25% delivery fee, excluding DigiKuntz platform fees';
        break;
      }
      case 'order_restaurant_share': {
        if (!isPaidOrBeyond(order.orderStatus)) {
          console.log(`  SKIP tx=${tx._id} (restaurant): order ${order._id} status is ${order.orderStatus} (not paid)`);
          skipped++;
          continue;
        }
        expectedAmount = amounts.restaurantAmount;
        note = distVersion >= 2
          ? 'Items + packaging - promotion - category flat fees'
          : 'Payment amount minus delivery and packaging fees';
        break;
      }
      case 'order_delivery_share': {
        if (!isDeliveredOrBeyond(order.orderStatus)) {
          console.log(`  SKIP tx=${tx._id} (driver): order ${order._id} status is ${order.orderStatus} (not delivered)`);
          skipped++;
          continue;
        }
        expectedAmount = amounts.driverAmount;
        note = distVersion >= 2 ? '85% delivery fee' : '75% delivery fee';
        break;
      }
      default: {
        console.log(`  SKIP tx=${tx._id}: unknown reason "${tx.reason}"`);
        skipped++;
        continue;
      }
    }

    if (expectedAmount <= 0) {
      console.log(`  SKIP tx=${tx._id}: computed amount is ${expectedAmount}, nothing to credit`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY] tx=${tx._id} | reason=${tx.reason} | order=${order._id} | status=${order.orderStatus} | amount=0 -> ${expectedAmount} | ${note}`);
    } else {
      await BalanceTransaction.updateOne(
        { _id: tx._id },
        { $set: { amount: expectedAmount, note } },
      );
      console.log(`  FIXED tx=${tx._id} | reason=${tx.reason} | order=${order._id} | amount=0 -> ${expectedAmount}`);
    }

    updated++;
  }

  if (updated > 0 && !DRY_RUN) {
    console.log(`\nRecalculating Balance documents...`);

    const affectedScopes: Array<{ name: string; match: any }> = [{ name: 'system', match: { ownerType: 'system' } }];
    const restaurantIds = Array.from(new Set(
      brokenTransactions.filter((tx: any) => tx.restaurantId).map((tx: any) => String(tx.restaurantId)),
    ));
    restaurantIds.forEach((id: string) => {
      affectedScopes.push({ name: `restaurant:${id}`, match: { ownerType: 'restaurant', restaurantId: new mongoose.Types.ObjectId(id) } });
    });
    const userIds = Array.from(new Set(
      brokenTransactions.filter((tx: any) => tx.userId).map((tx: any) => String(tx.userId)),
    ));
    userIds.forEach((id: string) => {
      affectedScopes.push({ name: `user:${id}`, match: { ownerType: 'user', userId: new mongoose.Types.ObjectId(id) } });
    });

    for (const scope of affectedScopes) {
      const [row] = await BalanceTransaction.aggregate([
        { $match: scope.match },
        { $group: { _id: null, balance: { $sum: '$amount' } } },
      ]);
      const balance = row?.balance || 0;
      console.log(`  Balance ${scope.name}: ${balance} XAF`);
    }

    console.log(`\nNOTE: The backfill cron (every 5min) will also recalculate Balance documents automatically.`);
  }

  console.log(`\nDone. ${updated} fixed, ${skipped} skipped (dry-run: ${DRY_RUN})`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
