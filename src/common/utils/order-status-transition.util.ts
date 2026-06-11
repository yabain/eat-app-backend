import { OrderStatus } from '../enums/order-status.enum';

const MANUAL_ORDER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.PAID]: [OrderStatus.CONFIRMED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING],
  [OrderStatus.PREPARING]: [OrderStatus.READY],
};

export function canManuallyTransitionOrderStatus(
  currentStatus: OrderStatus,
  nextStatus: OrderStatus,
): boolean {
  return MANUAL_ORDER_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

export function allowedManualOrderStatuses(currentStatus: OrderStatus): OrderStatus[] {
  return MANUAL_ORDER_TRANSITIONS[currentStatus] || [];
}
