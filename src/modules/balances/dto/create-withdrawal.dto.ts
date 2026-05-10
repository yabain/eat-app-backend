import { IsNumber, IsString, Min, Matches } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  @Matches(/^(?:237)?(?:67\d{7}|65[0-4]\d{6}|68[0-3]\d{6})$/, {
    message: 'Le retrait est uniquement disponible vers un numero MTN Cameroun valide',
  })
  phone: string;
}
