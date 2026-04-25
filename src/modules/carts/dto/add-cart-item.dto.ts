import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMongoId, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsMongoId()
  menuItemId: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
