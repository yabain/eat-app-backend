export enum OrderStatus {
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
  CONFIRMED = 'confirmed',
  PREPARING = 'preparing',
  READY = 'ready',
  ASSIGNED = 'assigned',
  OUT_FOR_DELIVERY = 'out_for_delivery',
  DELIVERED = 'delivered',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
  PAYMENT_FAILED = 'payment_failed',
}
