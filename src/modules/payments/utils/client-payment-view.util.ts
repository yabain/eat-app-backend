import { isAllowedPaymentLink } from './payment-link.util';

/**
 * Projection publique d'un Payment, renvoyée au client (`GET /payments/:orderId/status`).
 * Volontairement limitée : pas de `callbackPayload` (corps fournisseur), ni `providerRef`,
 * ni `transactionRef`. Le lien hébergé n'est renvoyé que s'il passe la liste blanche.
 */
export interface ClientPaymentView {
  id: string;
  orderId: string;
  status: string;
  amount: number;
  currency: string;
  provider: string;
  paymentMethod: string | null;
  outcome: string | null;
  operator: string | null;
  paymentLink: string | null;
  paymentWithTaxes: number | null;
  createdAt?: Date;
  updatedAt?: Date;
  completedAt?: Date;
}

export function toClientPaymentView(payment: any): ClientPaymentView {
  const view: ClientPaymentView = {
    id: String(payment._id),
    orderId: String(payment.orderId),
    status: payment.status,
    amount: Number(payment.amount),
    currency: payment.currency || 'XAF',
    provider: payment.provider || 'digikuntz',
    paymentMethod: payment.paymentMethod ?? null,
    outcome: payment.directChargeOutcome ?? null,
    operator: payment.directChargeOperator ?? null,
    paymentLink: isAllowedPaymentLink(payment.paymentLink) ? payment.paymentLink : null,
    paymentWithTaxes: payment.paymentWithTaxes ?? null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
  if (payment.completedAt) view.completedAt = payment.completedAt;
  return view;
}
