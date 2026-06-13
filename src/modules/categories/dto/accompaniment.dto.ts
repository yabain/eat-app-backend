import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAccompanimentDto {
  @ApiProperty({ example: 'Riz blanc' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 0, description: 'Ordre d\'affichage côté client.' })
  @IsOptional()
  @IsInt()
  order?: number;
}

export class UpdateAccompanimentDto {
  @ApiPropertyOptional({ example: 'Riz parfumé' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  order?: number;
}
