import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateSubscriptionPackDto {
    @IsString()
    examId: string;

    @IsString()
    name: string;

    @IsNumber()
    durationDays: number;

    @IsNumber()
    price: number;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}
