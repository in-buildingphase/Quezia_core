import { Injectable } from '@nestjs/common';
import { QuestionRepository } from './question.repository';
import { QuestionSelectionRequest } from './dto/selection-request.dto';
import { Question } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class QuestionSelectionService {
    constructor(private readonly repository: QuestionRepository) { }

    async selectQuestions(request: QuestionSelectionRequest): Promise<Question[]> {
        const { filters, deterministicSeed, totalRequired, excludeQuestionIds } = request;

        // In a real scenario, we might need to handle multiple subjects/topics from filters
        // For this implementation, we assume one subject/topic per request for simplicity
        // or we iterate over subjects/topics as defined in the filters.

        const allSelected: Question[] = [];

        for (const subjectFilter of filters.subjects) {
            const topicsToFilter = subjectFilter.topics.length > 0 ? subjectFilter.topics : [undefined];

            for (const topic of topicsToFilter) {
                // Handle distribution across difficulties
                for (const [difficultyStr, count] of Object.entries(subjectFilter.difficultyDistribution)) {
                    const difficulty = difficultyStr.toUpperCase() as any;

                    const eligible = await this.repository.findEligibleQuestions({
                        subject: subjectFilter.name,
                        topic: topic,
                        difficulty,
                        excludeIds: excludeQuestionIds,
                    });

                    // Deterministic sort
                    const sorted = eligible.sort((a, b) => {
                        const hashA = this.hash(a.questionId + deterministicSeed);
                        const hashB = this.hash(b.questionId + deterministicSeed);
                        return hashA.localeCompare(hashB);
                    });

                    allSelected.push(...sorted.slice(0, count));
                }
            }
        }

        return allSelected.slice(0, totalRequired);
    }

    private hash(input: string): string {
        return crypto.createHash('sha256').update(input).digest('hex');
    }
}
