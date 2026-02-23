import { IsArray, IsString, ArrayNotEmpty } from 'class-validator';

/**
 * Payload for reordering questions in a DRAFT test.
 * orderedIds: full array of TestQuestion.id values in the desired sequence.
 */
export class ReorderQuestionsDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    orderedIds: string[];
}
