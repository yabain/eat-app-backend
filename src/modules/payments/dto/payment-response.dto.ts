import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus } from '../../../common/enums/payment-status.enum';
import { PaginationMetaDto } from '../../../common/dto/response.dto';

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
