import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsMongoId()
  menuItemId: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  /**
   * _id de l'accompagnement choisi par le client (Category.accompaniments[i]._id).
   * Doit appartenir à MenuItem.availableAccompanimentIds.
   */
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f61888' })
  @IsOptional()
  @IsMongoId()
  accompanimentId?: string;
}
