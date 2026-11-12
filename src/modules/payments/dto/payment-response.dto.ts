import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus } from '../../../common/enums/payment-status.enum';
import { PaginationMetaDto } from '../../../common/dto/response.dto';
import { DIRECT_CHARGE_ERROR_CODES, DirectChargeErrorCode } from '../errors/direct-charge.errors';
import { DIRECT_CHARGE_OPERATORS, DirectChargeOperator } from '../utils/mobile-money.util';

export class PaymentResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  orderId: string;

  @ApiProperty({ example: 'digikuntz' })
  provider: string;

  @ApiProperty({ example: 4200 })
  amount: number;

  @ApiProperty({ example: 'XAF' })
  currency: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PROCESSING })
  status: PaymentStatus;

  @ApiPropertyOptional({ example: 'DK-3b77f9a12ce1' })
  providerRef?: string;

  @ApiPropertyOptional({ example: 'IN123#250101120000' })
  transactionRef?: string;

  @ApiPropertyOptional({ example: 'https://checkout.flutterwave.com/v3/hosted/pay/xxxxx' })
  paymentLink?: string;

  @ApiPropertyOptional({ example: 4410 })
  paymentWithTaxes?: number;

  @ApiPropertyOptional({ example: 210 })
  invoiceTaxes?: number;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  initiatedAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:05:00.000Z' })
  completedAt?: string;
}

export class PaymentCheckoutResponseDto {
  @ApiProperty({ example: '664f1a2b3c4d5e6f7a8b9c0d', description: 'ID de la transaction DigiKuntz (providerRef)' })
  providerRef: string;

  @ApiPropertyOptional({ example: 'IN123#250101120000', description: 'Référence interne DigiKuntz' })
  transactionRef?: string;

  @ApiProperty({ example: 4200, description: 'Montant estimé (hors taxes)' })
  amount: number;

  @ApiPropertyOptional({ example: 4410, description: 'Montant total avec taxes' })
  paymentWithTaxes?: number;

  @ApiPropertyOptional({ example: 210, description: 'Montant des taxes' })
  invoiceTaxes?: number;

  @ApiProperty({ example: 'https://checkout.flutterwave.com/v3/hosted/pay/xxxxx', description: 'URL du gateway de paiement à ouvrir côté frontend' })
  paymentLink: string;

  @ApiProperty({ example: 'payin_pending', description: 'Statut initial: payin_pending | payin_success | payin_error | payin_closed' })
  status: string;
}

export class PaymentInitiateResponseDto {
  @ApiProperty({ type: PaymentResponseDto })
  payment: PaymentResponseDto;

  @ApiProperty({ type: PaymentCheckoutResponseDto })
  checkout: PaymentCheckoutResponseDto;
}

/**
 * Réponse de `POST /payments/initiate-direct/:orderId` (HTTP 201).
 * Ne contient ni le numéro de téléphone ni aucun corps fournisseur.
 */
export class DirectChargeInitiateResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e', description: 'Identifiant du Payment' })
  paymentId: string;

  @ApiProperty({ example: '665c58e63d7bfeb8f7f6172e' })
  orderId: string;

  @ApiProperty({ example: 4200, description: 'Montant estimé en XAF (hors taxes)' })
  amount: number;

  @ApiProperty({ enum: ['XAF'], example: 'XAF' })
  currency: 'XAF';

  @ApiProperty({ enum: Object.values(PaymentStatus), example: PaymentStatus.PROCESSING })
  status: string;

  @ApiProperty({ enum: DIRECT_CHARGE_OPERATORS, example: 'ORANGEMONEY', description: 'Opérateur effectivement utilisé' })
  operator: DirectChargeOperator;

  @ApiProperty({
    enum: ['prompt_sent', 'refused'],
    example: 'prompt_sent',
    description: 'prompt_sent = demande de confirmation envoyée sur le téléphone ; refused = DigiKuntz a refusé le direct, utiliser paymentLink',
  })
  outcome: 'prompt_sent' | 'refused';

  @ApiProperty({ example: false, description: 'true si et seulement si outcome = refused' })
  fallback: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Lien de paiement hébergé (https, hôte autorisé), uniquement si fallback = true',
  })
  paymentLink: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '#150*50#',
    description: 'Code USSD de confirmation configuré pour l’opérateur ; null si non configuré',
  })
  ussdCode: string | null;
}

/** Corps d'erreur des routes de paiement direct, construit explicitement côté service. */
export class DirectChargeErrorDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({ enum: [...DIRECT_CHARGE_ERROR_CODES], example: 'PAYMENT_OUTCOME_UNKNOWN' })
  code: DirectChargeErrorCode;

  @ApiProperty({
    example: 'Nous ne pouvons pas confirmer si la demande de paiement a abouti.',
    description: 'Message français court, sans détail technique',
  })
  message: string;
}

/**
 * Vue client du dernier paiement d'une commande (`GET /payments/:orderId/status`).
 * Projection volontaire : ni callbackPayload (corps fournisseur), ni providerRef, ni transactionRef.
 */
export class ClientPaymentStatusDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  id: string;

  @ApiProperty({ example: '665c58e63d7bfeb8f7f6172e' })
  orderId: string;

  @ApiProperty({ enum: Object.values(PaymentStatus), example: PaymentStatus.PROCESSING })
  status: string;

  @ApiProperty({ example: 4200 })
  amount: number;

  @ApiProperty({ example: 'XAF' })
  currency: string;

  @ApiProperty({ example: 'digikuntz' })
  provider: string;

  @ApiProperty({ type: String, nullable: true, example: 'direct_charge' })
  paymentMethod: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['calling', 'prompt_sent', 'refused', 'unknown', 'rejected', null],
    example: 'prompt_sent',
    description: 'Issue du paiement direct (absente pour un paiement hébergé)',
  })
  outcome: string | null;

  @ApiProperty({ type: String, nullable: true, enum: [...DIRECT_CHARGE_OPERATORS, null], example: 'MTN' })
  operator: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Lien hébergé, uniquement s’il est valide (https, hôte autorisé)',
  })
  paymentLink: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 4410 })
  paymentWithTaxes: number | null;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  createdAt?: Date;

  @ApiPropertyOptional({ example: '2026-04-25T12:01:00.000Z' })
  updatedAt?: Date;

  @ApiPropertyOptional({ example: '2026-04-25T12:05:00.000Z' })
  completedAt?: Date;
}

export class PaymentStatusResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  orderId: string;

  @ApiProperty({ example: 'digikuntz' })
  provider: string;

  @ApiProperty({ example: 4200 })
  amount: number;

  @ApiProperty({ example: 'XAF' })
  currency: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PAID })
  status: PaymentStatus;

  @ApiPropertyOptional({ example: '664f1a2b3c4d5e6f7a8b9c0d', description: 'ID de la transaction DigiKuntz' })
  providerRef?: string;

  @ApiPropertyOptional({ example: 'IN123#250101120000' })
  transactionRef?: string;

  @ApiPropertyOptional({ example: 'https://checkout.flutterwave.com/v3/hosted/pay/xxxxx' })
  paymentLink?: string;

  @ApiPropertyOptional({ example: 4410 })
  paymentWithTaxes?: number;

  @ApiPropertyOptional({ example: 210 })
  invoiceTaxes?: number;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  initiatedAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:05:00.000Z' })
  completedAt?: string;
}

export class PaymentSyncResponseDto {
  @ApiProperty({ type: PaymentStatusResponseDto })
  payment: PaymentStatusResponseDto;

  @ApiProperty({ example: 'payin_success', description: 'Statut retourné par DigiKuntz' })
  remoteStatus: string;

  @ApiPropertyOptional({ type: PaymentCheckoutResponseDto })
  checkout?: PaymentCheckoutResponseDto;

  @ApiProperty({
    example: {
      _id: '665d58e63d7bfeb8f7f6172e',
      orderNumber: 'ORD-1713640000000-ABCDE',
      paymentStatus: PaymentStatus.PAID,
      orderStatus: 'paid',
    },
  })
  order: Record<string, any>;
}


export class PaginatedPaymentsResponseDto {
  @ApiProperty({ type: [PaymentResponseDto] })
  data: PaymentResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
