import { DeliveryStatus } from '../enums/delivery-status.enum';

const DELIVERY_TRANSITIONS: Partial<Record<DeliveryStatus, DeliveryStatus[]>> = {
  [DeliveryStatus.ASSIGNED]: [
    DeliveryStatus.PICKED_UP,
    DeliveryStatus.OUT_FOR_DELIVERY,
    DeliveryStatus.FAILED,
  ],
  [DeliveryStatus.PICKED_UP]: [
    DeliveryStatus.OUT_FOR_DELIVERY,
    DeliveryStatus.FAILED,
  ],
  [DeliveryStatus.OUT_FOR_DELIVERY]: [
    DeliveryStatus.DELIVERED,
    DeliveryStatus.FAILED,
  ],
};

export function canTransitionDeliveryStatus(
  currentStatus: DeliveryStatus,
  nextStatus: DeliveryStatus,
): boolean {
  return DELIVERY_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

export function allowedDeliveryStatuses(currentStatus: DeliveryStatus): DeliveryStatus[] {
  return DELIVERY_TRANSITIONS[currentStatus] || [];
}
