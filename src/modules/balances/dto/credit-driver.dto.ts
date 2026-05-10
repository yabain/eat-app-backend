import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreditDriverDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;
}
