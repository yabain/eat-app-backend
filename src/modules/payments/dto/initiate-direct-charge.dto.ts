import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { DirectChargeOperator } from '../utils/mobile-money.util';

/**
 * Paramètres optionnels du paiement direct. Sans body, le backend utilise le
 * téléphone du profil (comportement historique). Le frontend envoie le numéro
 * prérempli et le réseau sélectionné.
 */
export class InitiateDirectChargeDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsIn(['ORANGEMONEY', 'MTN'])
  paymentMethodCode?: DirectChargeOperator;
}