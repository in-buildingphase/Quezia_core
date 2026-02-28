import { IsOptional, IsString } from 'class-validator';

export class CreateSubscriptionDto {
  @IsString()
  packId: string;

  @IsString()
  @IsOptional()
  paymentProvider?: string;

  @IsString()
  @IsOptional()
  providerReference?: string;
}
