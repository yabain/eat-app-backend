import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { normalizeCameroonPhone } from '../../../common/utils/cameroon-mobile-money.util';

export class CreateWithdrawalDto {
  @IsNumber()
  @IsInt()
  @Min(1)
  amount: number;

  /**
   * Clé fournie par le client pour rendre le POST idempotent (double-clic,
   * retry réseau). Optionnelle : le serveur en génère une, et tant qu'un
   * retrait identique reste non résolu, une nouvelle demande sans clé renvoie
   * ce retrait au lieu d'en créer un second.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'Invalid idempotency key' })
  idempotencyKey?: string;

  @IsString()
  @Transform(({ value }) => normalizeCameroonPhone(String(value ?? '')))
  @Matches(/^(?:(?:67\d{7}|65[0-4]\d{6}|68[0-5]\d{6})|(?:69\d{7}|65[5-9]\d{6}|68[6-9]\d{6}))$/, {
    message: 'Utilisez un numéro MTN Mobile Money ou Orange Money Cameroun valide de 9 chiffres',
  })
  phone: string;
}
