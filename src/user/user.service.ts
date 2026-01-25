import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateContextDto } from './dto/update-profile.dto';

@Injectable()
export class UserService {
	constructor(private readonly prisma: PrismaService) {}

	async getMe(userId: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				email: true,
				username: true,
				profile: {
					select: {
						activeExamId: true,
						activeExamYear: true,
						accountTier: true,
						displayName: true,
						country: true,
						timezone: true,
					},
				},
			},
		});

		if (!user) {
			throw new NotFoundException('User not found');
		}

		return user;
	}

	async updateContext(userId: string, payload: UpdateContextDto) {
		await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

		await this.prisma.userProfile.upsert({
			where: { userId },
			update: {
				activeExamId: payload.activeExamId ?? null,
				activeExamYear: payload.activeExamYear ?? null,
			},
			create: {
				userId,
				activeExamId: payload.activeExamId ?? null,
				activeExamYear: payload.activeExamYear ?? null,
			},
		});

		return this.getMe(userId);
	}
}
