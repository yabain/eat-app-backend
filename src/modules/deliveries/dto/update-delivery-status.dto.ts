import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DELIVERY_STATUS_VALUES } from '../../../common/enums/delivery-status.enum';

export class UpdateDeliveryStatusDto {
  @ApiProperty({ example: 'out_for_delivery', enum: DELIVERY_STATUS_VALUES })
  @IsIn(DELIVERY_STATUS_VALUES)
  status: string;
}
