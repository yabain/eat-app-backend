import { IsEnum } from 'class-validator';
import { OrderStatus } from '../../../common/enums/order-status.enum';
import { ApiProperty } from '@nestjs/swagger';
export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus, example: OrderStatus.PREPARING })
  @IsEnum(OrderStatus) orderStatus: OrderStatus;
}
