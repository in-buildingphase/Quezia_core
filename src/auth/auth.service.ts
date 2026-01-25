import {
	ConflictException,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { authConstants } from '../common/constants/app.constants';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './strategies/jwt.strategy';

type AuthTokens = {
	accessToken: string;
	refreshToken: string;
};

type AuthUser = {
	id: string;
	email: string;
};

type AuthResponse = AuthTokens & { user: AuthUser };

@Injectable()
export class AuthService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly jwtService: JwtService,
	) {}

	async register(payload: RegisterDto): Promise<AuthResponse> {
		const existing = await this.prisma.user.findFirst({
			where: {
				OR: [{ email: payload.email }, { username: payload.username }],
			},
		});

		if (existing) {
			throw new ConflictException('User already exists');
		}

		const passwordHash = await this.hashPassword(payload.password);

		const user = await this.prisma.user.create({
			data: {
				email: payload.email,
				username: payload.username,
				passwordHash,
				profile: {
					create: {},
				},
			},
		});

		return this.buildAuthResponse(user.id, user.email);
	}

	async login(payload: LoginDto): Promise<AuthResponse> {
		const user = await this.prisma.user.findUnique({
			where: { email: payload.email },
		});

		if (!user) {
			throw new UnauthorizedException('Invalid credentials');
		}

		const isValid = await bcrypt.compare(payload.password, user.passwordHash);

		if (!isValid) {
			throw new UnauthorizedException('Invalid credentials');
		}

		await this.prisma.user.update({
			where: { id: user.id },
			data: { lastLogin: new Date() },
		});

		return this.buildAuthResponse(user.id, user.email);
	}

	async refreshTokens(payload: RefreshTokenDto): Promise<AuthResponse> {
		let decoded: JwtPayload;

		try {
			decoded = await this.jwtService.verifyAsync<JwtPayload>(payload.refreshToken, {
				secret: authConstants.refreshTokenSecret,
			});
		} catch (error) {
			throw new UnauthorizedException('Invalid refresh token');
		}

		const user = await this.prisma.user.findUnique({ where: { id: decoded.sub } });

		if (!user) {
			throw new UnauthorizedException('Invalid refresh token');
		}

		return this.buildAuthResponse(user.id, user.email);
	}

	private async hashPassword(password: string): Promise<string> {
		return bcrypt.hash(password, authConstants.bcryptSaltOrRounds);
	}

	private signTokens(user: AuthUser): AuthTokens {
		const payload: JwtPayload = { sub: user.id, email: user.email };

		const expiresInAccess = authConstants.accessTokenTtl as JwtSignOptions['expiresIn'];
		const expiresInRefresh = authConstants.refreshTokenTtl as JwtSignOptions['expiresIn'];

		const accessToken = this.jwtService.sign(payload, {
			secret: authConstants.accessTokenSecret,
			expiresIn: expiresInAccess,
		});

		const refreshToken = this.jwtService.sign(payload, {
			secret: authConstants.refreshTokenSecret,
			expiresIn: expiresInRefresh,
		});

		return { accessToken, refreshToken };
	}

	private buildAuthResponse(userId: string, email: string): AuthResponse {
		const tokens = this.signTokens({ id: userId, email });

		return {
			...tokens,
			user: { id: userId, email },
		};
	}
}
