import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class AssignDeliveryDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsString() orderId: string;
  @ApiProperty({ example: '665d58e63d7bfeb8f7f61999' })
  @IsString() driverId: string;
}
