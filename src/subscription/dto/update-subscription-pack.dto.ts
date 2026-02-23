import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateSubscriptionPackDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsNumber()
    @IsOptional()
    durationDays?: number;

    @IsNumber()
    @IsOptional()
    price?: number;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}
