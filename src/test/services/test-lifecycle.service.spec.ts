import { InternalServerErrorException } from '@nestjs/common';
import { AttemptStatus } from '@prisma/client';
import { TestLifecycleService } from './test-lifecycle.service';

describe('TestLifecycleService', () => {
  const createService = (findManyImpl: jest.Mock) =>
    new TestLifecycleService(
      {
        testAttempt: { findMany: findManyImpl },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

  it('returns the required flattened attempt summary shape', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'attempt-1',
        testId: 'test-1',
        userId: 'user-1',
        status: AttemptStatus.COMPLETED,
        startedAt: new Date('2026-03-17T10:00:00.000Z'),
        completedAt: new Date('2026-03-17T10:30:00.000Z'),
        totalScore: 96,
        accuracy: 0.8,
        timeSpentSeconds: 1800,
        percentile: 90,
        userRank: 5,
        riskRatio: 0.2,
        test: {
          threadId: 'thread-1',
        },
      },
    ]);
    const service = createService(findMany);

    await expect(service.getAttempts('user-1', 'thread-1')).resolves.toEqual([
      {
        id: 'attempt-1',
        testId: 'test-1',
        threadId: 'thread-1',
        userId: 'user-1',
        status: AttemptStatus.COMPLETED,
        startedAt: new Date('2026-03-17T10:00:00.000Z'),
        completedAt: new Date('2026-03-17T10:30:00.000Z'),
        totalScore: 96,
        accuracy: 0.8,
        timeSpentSeconds: 1800,
        percentile: 90,
        userRank: 5,
        riskRatio: 0.2,
      },
    ]);

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', test: { threadId: 'thread-1' } },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        testId: true,
        userId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        totalScore: true,
        accuracy: true,
        timeSpentSeconds: true,
        percentile: true,
        userRank: true,
        riskRatio: true,
        test: {
          select: {
            threadId: true,
          },
        },
      },
    });
  });

  it('throws when a completed attempt is missing totalScore or accuracy', async () => {
    const service = createService(
      jest.fn().mockResolvedValue([
        {
          id: 'attempt-1',
          testId: 'test-1',
          userId: 'user-1',
          status: AttemptStatus.COMPLETED,
          startedAt: new Date('2026-03-17T10:00:00.000Z'),
          completedAt: new Date('2026-03-17T10:30:00.000Z'),
          totalScore: null,
          accuracy: 0.8,
          timeSpentSeconds: 1800,
          percentile: 90,
          userRank: 5,
          riskRatio: 0.2,
          test: {
            threadId: 'thread-1',
          },
        },
      ]),
    );

    await expect(service.getAttempts('user-1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('throws when threadId is missing from the related test', async () => {
    const service = createService(
      jest.fn().mockResolvedValue([
        {
          id: 'attempt-1',
          testId: 'test-1',
          userId: 'user-1',
          status: AttemptStatus.ACTIVE,
          startedAt: new Date('2026-03-17T10:00:00.000Z'),
          completedAt: null,
          totalScore: null,
          accuracy: null,
          timeSpentSeconds: null,
          percentile: null,
          userRank: null,
          riskRatio: null,
          test: {
            threadId: null,
          },
        },
      ]),
    );

    await expect(service.getAttempts('user-1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});