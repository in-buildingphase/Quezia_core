import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitAnswerDto {
    @IsNotEmpty()
    @IsString()
    questionId: string;

    @IsNotEmpty()
    @IsString()
    answer: string;
}
