import { DeliveryStatus } from '../enums/delivery-status.enum';
import { OrderStatus } from '../enums/order-status.enum';

/**
 * Statuts livraison (suivi livreur) ≠ statuts commande (cycle global).
 * Ex. picked_up = colis récupéré chez le restaurant ; la commande reste "assigned".
 */
export function orderStatusForDeliveryStatus(
  deliveryStatus: string,
): OrderStatus | null {
  switch (deliveryStatus) {
    case DeliveryStatus.ASSIGNED:
    case DeliveryStatus.PICKED_UP:
      return OrderStatus.ASSIGNED;
    case DeliveryStatus.OUT_FOR_DELIVERY:
      return OrderStatus.OUT_FOR_DELIVERY;
    case DeliveryStatus.DELIVERED:
      return OrderStatus.DELIVERED;
    case DeliveryStatus.FAILED:
      return null;
    default:
      return null;
  }
}
