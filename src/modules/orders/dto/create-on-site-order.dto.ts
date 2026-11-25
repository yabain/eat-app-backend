import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OnSiteOrderItemDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsMongoId() menuItemId: string;
  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt() @Min(1) quantity: number;
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f61888', description: '_id d\'un accompagnement proposé sur cet item.' })
  @IsOptional() @IsMongoId() accompanimentId?: string;
  @ApiPropertyOptional({ example: 'Frites' })
  @IsOptional() @IsString() accompanimentName?: string;
}

export class CreateOnSiteOrderDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e', description: 'Obligatoire pour un admin. Ignoré/revalidé pour manager/employé (forcé à leur restaurant).' })
  @IsMongoId() restaurantId: string;
  @ApiProperty({ type: [OnSiteOrderItemDto], minItems: 1 })
  @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true }) @Type(() => OnSiteOrderItemDto)
  items: OnSiteOrderItemDto[];
  @ApiPropertyOptional({ example: 'Table 3', description: 'Étiquette de table (Phase 2 : positionId).' })
  @IsOptional() @IsString() @MaxLength(200) tableLabel?: string;
  @ApiPropertyOptional({ example: 'Sans oignons' })
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
