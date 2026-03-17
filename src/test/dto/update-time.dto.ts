import {
    IsNotEmpty,
    IsString,
    IsInt,
    IsPositive,
    Max,
    IsOptional,
    IsBoolean,
} from 'class-validator';

export class UpdateTimeDto {
    @IsNotEmpty()
    @IsString()
    questionId: string;

    @IsNotEmpty()
    @IsInt()
    @IsPositive()
    @Max(30000)
    deltaTime: number;

    @IsOptional()
    @IsBoolean()
    isNewVisit?: boolean;
}
