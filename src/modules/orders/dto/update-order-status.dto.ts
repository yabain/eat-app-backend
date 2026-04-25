import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from '../../../common/enums/order-status.enum';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus, example: OrderStatus.PREPARING })
  @IsEnum(OrderStatus) orderStatus: OrderStatus;
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f61999' })
  @IsOptional() @IsString() assignedDriverId?: string;
}
