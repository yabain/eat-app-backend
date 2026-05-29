import { IsIn, IsOptional, IsString } from 'class-validator';
import { WithdrawalStatus } from '../../../database/schemas/withdrawal-request.schema';

export class UpdateWithdrawalStatusDto {
  @IsIn(['approved', 'rejected', 'failed', 'paid'])
  status: Exclude<WithdrawalStatus, 'pending'>;

  @IsOptional()
  @IsString()
  note?: string;
}
