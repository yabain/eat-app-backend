import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../../../common/enums/order-status.enum';
import { PaymentStatus } from '../../../common/enums/payment-status.enum';
import { PaginationMetaDto } from '../../../common/dto/response.dto';

export class OrderUserResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiPropertyOptional({ example: 'Flambel' })
  firstName?: string;

  @ApiPropertyOptional({ example: 'SANOU' })
  lastName?: string;

  @ApiPropertyOptional({ example: 'flambel@example.com' })
  email?: string;

  @ApiPropertyOptional({ example: '+237691224472' })
  phone?: string;

  @ApiPropertyOptional({ example: '/uploads/profiles/avatar.png' })
  profileImage?: string;

  @ApiPropertyOptional({ example: 'client' })
  role?: string;
}

export class OrderRestaurantResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: 'Chez Flambel' })
  name: string;

  @ApiProperty({ example: 'chez-flambel' })
  slug: string;

  @ApiPropertyOptional({ example: 'Cuisine africaine' })
  description?: string;

  @ApiPropertyOptional({ example: '+237691224472' })
  phone?: string;

  @ApiPropertyOptional({ example: '+237691224472' })
  phone1?: string;

  @ApiPropertyOptional({ example: '+237691224473' })
  phone2?: string;

  @ApiPropertyOptional({ example: 'restaurant@example.com' })
  email?: string;

  @ApiPropertyOptional({ example: 'Akwa, Douala' })
  localisation?: string;

  @ApiPropertyOptional({ example: '/uploads/restaurants/logo.png' })
  logo?: string;

  @ApiPropertyOptional({ example: '/uploads/restaurants/banner.png' })
  bannerImage?: string;

  @ApiPropertyOptional({ example: '/uploads/restaurants/cover.png' })
  coverImage?: string;
}

export class OrderItemResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  menuItemId: string;

  @ApiProperty({ example: 'Poulet DG' })
  name: string;

  @ApiProperty({ example: 3500 })
  unitPrice: number;

  @ApiProperty({ example: 200 })
  packagingCost: number;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ example: 7000 })
  subtotal: number;
}

export class DeliveryAddressResponseDto {
  @ApiProperty({ example: 'Douala' })
  city: string;

  @ApiProperty({ example: 'Akwa' })
  district: string;

  @ApiProperty({ example: 'Immeuble blanc, 2e étage' })
  details: string;

  @ApiPropertyOptional({ example: 'https://maps.google.com/?q=5.0,10.0' })
  mapLink?: string;
}

export class PricingSnapshotResponseDto {
  @ApiProperty({ example: 5000 })
  itemsSubtotal: number;

  @ApiProperty({ example: 400 })
  packagingTotal: number;

  @ApiProperty({ example: 1500 })
  deliveryFee: number;

  @ApiProperty({ example: 500 })
  platformFee: number;

  @ApiProperty({ example: 500 })
  promoDiscount: number;

  @ApiProperty({ example: 6900 })
  grandTotal: number;
}

export class OrderPreviewResponseDto {
  @ApiProperty({ type: [OrderItemResponseDto], description: 'Items avec prix calculés' })
  items: OrderItemResponseDto[];

  @ApiProperty({ type: PricingSnapshotResponseDto })
  pricingSnapshot: PricingSnapshotResponseDto;
}

export class OrderResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: 'ORD-1713640000000-ABCDE' })
  orderNumber: string;

  @ApiProperty({
    oneOf: [
      { type: 'string', example: '665d58e63d7bfeb8f7f6172e' },
      { $ref: '#/components/schemas/OrderUserResponseDto' },
    ],
  })
  userId: string | OrderUserResponseDto;

  @ApiProperty({
    oneOf: [
      { type: 'string', example: '665d58e63d7bfeb8f7f6172e' },
      { $ref: '#/components/schemas/OrderRestaurantResponseDto' },
    ],
  })
  restaurantId: string | OrderRestaurantResponseDto;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  @ApiProperty({ type: DeliveryAddressResponseDto })
  deliveryAddress: DeliveryAddressResponseDto;

  @ApiProperty({ type: PricingSnapshotResponseDto })
  pricingSnapshot: PricingSnapshotResponseDto;

  @ApiPropertyOptional({ example: 25, description: 'Durée estimée de livraison en minutes' })
  deliveryEstimateMinutes?: number;

  @ApiPropertyOptional({ example: '2026-04-25T12:30:00.000Z', description: 'Date de passage en livraison' })
  outForDeliveryAt?: string;

  @ApiPropertyOptional({ example: 'WELCOME500' })
  promoCode?: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PENDING })
  paymentStatus: PaymentStatus;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.PENDING_PAYMENT })
  orderStatus: OrderStatus;

  @ApiPropertyOptional({ example: 'Appeler à l’arrivée' })
  notes?: string;

  @ApiPropertyOptional({
    oneOf: [
      { type: 'string', example: '665d58e63d7bfeb8f7f6172e' },
      { $ref: '#/components/schemas/OrderUserResponseDto' },
    ],
    nullable: true,
  })
  assignedDriverId?: string | OrderUserResponseDto | null;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  updatedAt?: string;
}

export class PaginatedOrdersResponseDto {
  @ApiProperty({ type: [OrderResponseDto] })
  data: OrderResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
