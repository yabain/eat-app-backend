import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class OrderInputItemDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsString() menuItemId: string;
  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class PreviewOrderDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsString() restaurantId: string;
  @ApiProperty({ type: [OrderInputItemDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderInputItemDto) items: OrderInputItemDto[];
  @ApiProperty({ example: 'Douala' })
  @IsString() city: string;
  @ApiProperty({ example: 'Akwa' })
  @IsString() district: string;
  @ApiProperty({ example: 'Rue 123, immeuble bleu, 3e etage' })
  @IsString() details: string;
  @ApiPropertyOptional({ example: 'WELCOME500' })
  @IsOptional() @IsString() promoCode?: string;
  @ApiPropertyOptional({ example: 'Sans piment' })
  @IsOptional() @IsString() notes?: string;
}
