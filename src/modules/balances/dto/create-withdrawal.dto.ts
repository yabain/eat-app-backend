import { Transform } from 'class-transformer';
import { IsNumber, IsString, Min, Matches } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  @Transform(({ value }) => String(value ?? '').replace(/\D/g, ''))
  @Matches(/^(?:67\d{7}|65[0-4]\d{6}|68[0-3]\d{6})$/, {
    message: 'Le retrait est uniquement disponible vers un numéro MTN Cameroun de 9 chiffres commençant par 6',
  })
  phone: string;
}
