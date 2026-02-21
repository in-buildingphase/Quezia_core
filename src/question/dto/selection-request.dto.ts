export class QuestionSelectionRequest {
    examId: string;
    filters: {
        subjects: {
            name: string;
            topics: string[];
            difficultyDistribution: {
                easy: number;
                medium: number;
                hard: number;
            };
        }[];
    };
    questionType?: string;
    totalRequired: number;
    excludeQuestionIds: string[];
    deterministicSeed: string;
}
