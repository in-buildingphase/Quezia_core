import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ExamBlueprintSectionDto {
  @IsString()
  subject: string;

  @IsInt()
  sequence: number;

  @IsInt()
  @IsOptional()
  sectionDurationSeconds?: number;

  /** Number of questions to select for this section. Defaults to 30. */
  @IsInt()
  @IsOptional()
  @Min(1)
  questionCount?: number;

  /** Marks awarded per correct question in this section. Defaults to 4. */
  @IsNumber()
  @IsOptional()
  marksPerQuestion?: number;
}

export class ExamRuleDto {
  @IsInt()
  totalTimeSeconds: number;

  @IsBoolean()
  negativeMarking: boolean;

  @IsNumber()
  @IsOptional()
  negativeMarkValue?: number;

  @IsBoolean()
  partialMarking: boolean;

  @IsBoolean()
  adaptiveAllowed: boolean;

  @IsDateString()
  effectiveFrom: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string;
}

export class CreateBlueprintDto {
  @IsInt()
  version: number;

  @IsInt()
  defaultDurationSeconds: number;

  @IsDateString()
  effectiveFrom: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamBlueprintSectionDto)
  sections: ExamBlueprintSectionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamRuleDto)
  rules: ExamRuleDto[];
}
