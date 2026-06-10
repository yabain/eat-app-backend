import { Transform } from 'class-transformer';
import { IsNumber, IsString, Min, Matches } from 'class-validator';
import { normalizeCameroonPhone } from '../../../common/utils/cameroon-mobile-money.util';

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  @Transform(({ value }) => normalizeCameroonPhone(String(value ?? '')))
  @Matches(/^(?:(?:67\d{7}|65[0-4]\d{6}|68[0-3]\d{6})|(?:69\d{7}|65[5-9]\d{6}|68[5-9]\d{6}))$/, {
    message: 'Utilisez un numéro MTN Mobile Money ou Orange Money Cameroun valide de 9 chiffres',
  })
  phone: string;
}
