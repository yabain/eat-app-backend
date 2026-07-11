import { IsMongoId } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReassignDeliveryDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsMongoId()
  driverId: string;
}
