import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateContextDto } from './dto/update-context.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
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

  @Patch('me/profile')
  updateProfile(
    @CurrentUser() user: { userId: string },
    @Body() payload: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(user.userId, payload);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Patch(':id/suspend')
  suspendUser(@Param('id') id: string) {
    return this.userService.suspendUser(id);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Patch(':id/activate')
  activateUser(@Param('id') id: string) {
    return this.userService.activateUser(id);
  }
}
