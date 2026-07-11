import { OrderStatus } from '../enums/order-status.enum';
import { UserRole } from '../enums/roles.enum';

const MANUAL_ORDER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.PAID]: [OrderStatus.CONFIRMED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING],
  [OrderStatus.PREPARING]: [OrderStatus.READY],
};

const ADMIN_ORDER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.ASSIGNED]: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED],
  [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.CLOSED],
};

export function canManuallyTransitionOrderStatus(
  currentStatus: OrderStatus,
  nextStatus: OrderStatus,
  role?: UserRole,
): boolean {
  if (role && [UserRole.ADMIN, UserRole.MANAGER].includes(role)) {
    if (ADMIN_ORDER_TRANSITIONS[currentStatus]?.includes(nextStatus)) return true;
  }
  return MANUAL_ORDER_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

export function allowedManualOrderStatuses(
  currentStatus: OrderStatus,
  role?: UserRole,
): OrderStatus[] {
  const adminTransitions = role && [UserRole.ADMIN, UserRole.MANAGER].includes(role)
    ? (ADMIN_ORDER_TRANSITIONS[currentStatus] || [])
    : [];
  const manualTransitions = MANUAL_ORDER_TRANSITIONS[currentStatus] || [];
  return [...adminTransitions, ...manualTransitions];
}
