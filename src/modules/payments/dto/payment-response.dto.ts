import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus } from '../../../common/enums/payment-status.enum';

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

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  initiatedAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:05:00.000Z' })
  completedAt?: string;
}

export class PaymentCheckoutResponseDto {
  @ApiProperty({ example: 'pending' })
  status: string;

  @ApiPropertyOptional({ example: 'https://checkout.example.local/pay/ORD-1713640000000-ABCDE' })
  paymentUrl?: string;
}

export class PaymentInitiateResponseDto {
  @ApiProperty({ type: PaymentResponseDto })
  payment: PaymentResponseDto;

  @ApiProperty({ type: PaymentCheckoutResponseDto })
  checkout: PaymentCheckoutResponseDto;
}

export class PaymentStatusResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  orderId: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PAID })
  status: PaymentStatus;

  @ApiProperty({ example: 4200 })
  amount: number;

  @ApiPropertyOptional({ example: 'DK-3b77f9a12ce1' })
  providerRef?: string;
}
