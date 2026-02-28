import { IsNotEmpty, IsString, IsOptional, IsNumber } from 'class-validator';

export class SubmitAnswerDto {
  @IsNotEmpty()
  @IsString()
  questionId: string;

  @IsNotEmpty()
  @IsString()
  answer: string;

  @IsOptional()
  @IsNumber()
  timeSpentSeconds?: number;

  @IsOptional()
  visitationData?: any;
}
