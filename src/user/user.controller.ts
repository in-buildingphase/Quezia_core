import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UpdateContextDto } from './dto/update-profile.dto';
import { UserService } from './user.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
	constructor(private readonly userService: UserService) {}

	@Get('me')
	getMe(@CurrentUser() user: { userId: string }) {
		return this.userService.getMe(user.userId);
	}

	@Patch('me/context')
	updateContext(
		@CurrentUser() user: { userId: string },
		@Body() payload: UpdateContextDto,
	) {
		return this.userService.updateContext(user.userId, payload);
	}
}
