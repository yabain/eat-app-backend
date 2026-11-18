import { IsIn, IsOptional, IsString } from 'class-validator';
import { WithdrawalStatus } from '../../../database/schemas/withdrawal-request.schema';

export class UpdateWithdrawalStatusDto {
  // `approved` est un état hérité sans cron de reprise : on ne permet plus de
  // l'atteindre manuellement (il laisserait les fonds bloqués).
  @IsIn(['rejected', 'failed', 'paid'])
  status: Exclude<WithdrawalStatus, 'pending' | 'approved'>;

  @IsOptional()
  @IsString()
  note?: string;
}
