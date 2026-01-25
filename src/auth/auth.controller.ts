import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Public()
	@Post('register')
	@HttpCode(HttpStatus.CREATED)
	register(@Body() payload: RegisterDto) {
		return this.authService.register(payload);
	}

	@Public()
	@Post('login')
	@HttpCode(HttpStatus.OK)
	login(@Body() payload: LoginDto) {
		return this.authService.login(payload);
	}

	@Public()
	@Post('refresh')
	@HttpCode(HttpStatus.OK)
	refresh(@Body() payload: RefreshTokenDto) {
		return this.authService.refreshTokens(payload);
	}
}
