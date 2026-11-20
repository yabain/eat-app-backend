import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class MoveCategoryDto {
  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  @IsIn(['up', 'down'])
  direction: 'up' | 'down';
}