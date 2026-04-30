import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DigikuntzWebhookDataDto {
  @ApiPropertyOptional({ example: '10000' }) estimation?: string;
  @ApiPropertyOptional({ example: 'IN123#250101120000' }) transactionRef?: string;
  @ApiPropertyOptional({ example: '500' }) invoiceTaxes?: string;
  @ApiPropertyOptional({ example: '10500' }) paymentWithTaxes?: string;
  @ApiPropertyOptional({ example: 'Test payment' }) raisonForTransfer?: string;
  @ApiPropertyOptional({ example: 'XAF' }) receiverCurrency?: string;
  @ApiPropertyOptional({ example: 'apiCall' }) transactionType?: string;
  @ApiPropertyOptional({ example: 'https://checkout.flutterwave.com/v3/hosted/pay/xxxxx' }) paymentLink?: string;
  @ApiPropertyOptional({ example: '2025-01-01T12:00:00.000Z' }) createdAt?: string;
  @ApiPropertyOptional({ example: '2025-01-01T12:00:00.000Z' }) updatedAt?: string;
}

export class DigikuntzWebhookDto {
  @ApiProperty({ example: '664f1a2b3c4d5e6f7a8b9c0d', description: 'ID de la transaction DigiKuntz' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'payin_success', description: 'payin_pending | payin_success | payin_error | payin_closed' })
  @IsString()
  status: string;

  @ApiPropertyOptional({ type: () => DigikuntzWebhookDataDto })
  @IsOptional()
  data?: DigikuntzWebhookDataDto;
}
