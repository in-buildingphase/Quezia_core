import { IsEnum, IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';
import { TestOriginType } from '@prisma/client';

export class CreateThreadDto {
    @IsString()
    @IsNotEmpty()
    examId: string;

    @IsEnum(TestOriginType)
    @IsNotEmpty()
    originType: TestOriginType;

    @IsString()
    @IsNotEmpty()
    title: string;

    @IsObject()
    @IsNotEmpty()
    baseGenerationConfig: any;
}
