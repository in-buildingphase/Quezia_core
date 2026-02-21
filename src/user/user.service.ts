import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateContextDto } from './dto/update-profile.dto';

@Injectable()
export class UserService {
	constructor(private readonly prisma: PrismaService) { }

	async getMe(userId: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				email: true,
				username: true,
				profile: {
					select: {
						targetExamId: true,
						targetExamYear: true,
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
				targetExamId: payload.targetExamId ?? null,
				targetExamYear: payload.targetExamYear ?? null,
			},
			create: {
				userId,
				targetExamId: payload.targetExamId ?? null,
				targetExamYear: payload.targetExamYear ?? null,
			},
		});

		return this.getMe(userId);
	}
}
