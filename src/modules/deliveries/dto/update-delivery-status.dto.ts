import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class UpdateDeliveryStatusDto {
  @ApiProperty({ example: 'out_for_delivery' })
  @IsString() status: string;
}
