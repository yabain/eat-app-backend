import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : undefined;
};

export class CreateProspectDto {
  @ApiPropertyOptional({ example: 'Flambel SANOU' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'prospect@example.com' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '691224472', description: 'Numéro sans indicatif pays' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  phone?: string;
}

export class UpdateProspectDto extends CreateProspectDto {}
