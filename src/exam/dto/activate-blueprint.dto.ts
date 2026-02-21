import { IsDateString, IsOptional } from 'class-validator';

export class ActivateBlueprintDto {
    @IsDateString()
    effectiveFrom: string;

    @IsDateString()
    @IsOptional()
    effectiveTo?: string;
}
