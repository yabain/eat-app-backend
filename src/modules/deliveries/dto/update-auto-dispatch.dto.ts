import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAutoDispatchDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;
}
