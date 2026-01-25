import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
	imports: [PrismaModule],
	controllers: [UserController],
	providers: [UserService, JwtAuthGuard],
	exports: [UserService],
})
export class UserModule {}
