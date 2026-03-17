import { UserRole } from '@prisma/client';
import { TestService } from './test.service';

describe('TestService', () => {
  it('returns the required thread summary shape for learners', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'thread-1',
        examId: 'exam-1',
        originType: 'GENERATED',
        createdByUserId: 'user-1',
        title: 'Physics drill',
        baseGenerationConfig: {
          subjects: ['Physics'],
          difficulty: 'HARD',
          ignored: 'value',
        },
        createdAt: new Date('2026-03-17T10:00:00.000Z'),
      },
    ]);

    const service = new TestService({
      testThread: { findMany },
    } as any);

    await expect(
      service.getThreadsByUser('user-1', UserRole.LEARNER),
    ).resolves.toEqual([
      {
        id: 'thread-1',
        examId: 'exam-1',
        originType: 'GENERATED',
        createdByUserId: 'user-1',
        title: 'Physics drill',
        baseGenerationConfig: {
          subjects: ['Physics'],
          difficulty: 'HARD',
        },
        createdAt: new Date('2026-03-17T10:00:00.000Z'),
      },
    ]);

    expect(findMany).toHaveBeenCalledWith({
      where: { createdByUserId: 'user-1' },
      select: {
        id: true,
        examId: true,
        originType: true,
        createdByUserId: true,
        title: true,
        baseGenerationConfig: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns null subjects and difficulty when baseGenerationConfig is not an object', async () => {
    const service = new TestService({
      testThread: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'thread-1',
            examId: 'exam-1',
            originType: 'SYSTEM',
            createdByUserId: null,
            title: 'System mock',
            baseGenerationConfig: null,
            createdAt: new Date('2026-03-17T10:00:00.000Z'),
          },
        ]),
      },
    } as any);

    await expect(
      service.getThreadsByUser('admin-1', UserRole.ADMIN),
    ).resolves.toEqual([
      {
        id: 'thread-1',
        examId: 'exam-1',
        originType: 'SYSTEM',
        createdByUserId: null,
        title: 'System mock',
        baseGenerationConfig: {
          subjects: null,
          difficulty: null,
        },
        createdAt: new Date('2026-03-17T10:00:00.000Z'),
      },
    ]);
  });
});