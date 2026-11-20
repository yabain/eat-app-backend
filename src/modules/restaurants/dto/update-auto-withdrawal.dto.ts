import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import {
  normalizeCameroonPhone,
  type CameroonMobileMoneyOperator,
} from '../../../common/utils/cameroon-mobile-money.util';

/**
 * Configuration du retrait automatique du restaurant. Quand `enabled` est
 * vrai, le téléphone et le réseau sont obligatoires et doivent correspondre.
 */
export class UpdateAutoWithdrawalDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => normalizeCameroonPhone(String(value ?? '')) || undefined)
  @Matches(/^6\d{8}$/, {
    message: 'Numéro camerounais invalide (9 chiffres commençant par 6)',
  })
  phone?: string;

  @IsOptional()
  @IsIn(['MTN', 'ORANGEMONEY'])
  accountBankCode?: CameroonMobileMoneyOperator;
}