import {
	ConflictException,
	Injectable,
	UnauthorizedException,
	NotFoundException,
	BadRequestException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { authConstants } from '../common/constants/app.constants';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LogoutDto } from './dto/logout.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { UserRole, AuthEventType, AuthEventStatus } from '@prisma/client';

type AuthTokens = {
	accessToken: string;
	refreshToken: string;
};

type AuthUser = {
	id: string;
	email: string;
	role: UserRole;
};

type AuthResponse = AuthTokens & { user: AuthUser };

@Injectable()
export class AuthService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly jwtService: JwtService,
	) { }

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
		const emailVerificationToken = crypto.randomBytes(32).toString('hex');

		const user = await this.prisma.user.create({
			data: {
				email: payload.email,
				username: payload.username,
				passwordHash,
				emailVerificationToken,
				profile: {
					create: {},
				},
			},
		});

		const response = await this.buildAuthResponse(user.id, user.email, user.role);

		await this.logAuthEvent(user.id, AuthEventType.REGISTER, AuthEventStatus.SUCCESS);
		await this.logAuthEvent(user.id, AuthEventType.LOGIN, AuthEventStatus.SUCCESS);

		return response;
	}

	async login(payload: LoginDto): Promise<AuthResponse> {
		const user = await this.prisma.user.findUnique({
			where: { email: payload.email },
		});

		if (!user) {
			if (payload.email) await this.logAuthEvent(null, AuthEventType.LOGIN, AuthEventStatus.FAILURE, { reason: 'User not found', email: payload.email });
			throw new UnauthorizedException('Invalid credentials');
		}

		const isValid = await bcrypt.compare(payload.password, user.passwordHash);

		if (!isValid) {
			await this.logAuthEvent(user.id, AuthEventType.LOGIN, AuthEventStatus.FAILURE, { reason: 'Invalid password' });
			throw new UnauthorizedException('Invalid credentials');
		}

		if (!user.isActive) {
			await this.logAuthEvent(user.id, AuthEventType.LOGIN, AuthEventStatus.FAILURE, { reason: 'Account deactivated' });
			throw new UnauthorizedException('Account is disabled');
		}

		await this.prisma.user.update({
			where: { id: user.id },
			data: { lastLogin: new Date() },
		});

		const response = await this.buildAuthResponse(user.id, user.email, user.role);
		await this.logAuthEvent(user.id, AuthEventType.LOGIN, AuthEventStatus.SUCCESS);

		return response;
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

		const refreshTokenHash = await this.hashToken(payload.refreshToken);
		const session = await this.prisma.session.findFirst({
			where: { userId: user.id, refreshTokenHash },
		});

		if (!session || session.expiresAt < new Date()) {
			throw new UnauthorizedException('Invalid or expired session');
		}

		// Delete old session
		await this.prisma.session.delete({ where: { id: session.id } });

		return this.buildAuthResponse(user.id, user.email, user.role);
	}

	async logout(userId: string, payload: LogoutDto): Promise<{ message: string }> {
		const refreshTokenHash = await this.hashToken(payload.refreshToken);

		await this.prisma.session.deleteMany({
			where: { userId, refreshTokenHash },
		});

		await this.logAuthEvent(userId, AuthEventType.LOGOUT, AuthEventStatus.SUCCESS);

		return { message: 'Logged out successfully' };
	}

	async forgotPassword(payload: ForgotPasswordDto): Promise<{ message: string }> {
		const user = await this.prisma.user.findUnique({ where: { email: payload.email } });

		if (user) {
			const resetPasswordToken = crypto.randomBytes(32).toString('hex');
			// Expires in 1 hour
			const resetPasswordExpires = new Date(Date.now() + 3600000);

			await this.prisma.user.update({
				where: { id: user.id },
				data: { resetPasswordToken, resetPasswordExpires },
			});

			await this.logAuthEvent(user.id, AuthEventType.PASSWORD_RESET_REQUEST, AuthEventStatus.SUCCESS);

			// TODO: Send email through notification service
			console.log(`Password reset token for ${user.email}: ${resetPasswordToken}`);
		} else {
			await this.logAuthEvent(null, AuthEventType.PASSWORD_RESET_REQUEST, AuthEventStatus.FAILURE, { reason: 'User not found', email: payload.email });
		}

		// Always return successful to prevent email enumeration
		return { message: 'If that email address is in our database, we will send you an email to reset your password.' };
	}

	async verifyEmail(payload: VerifyEmailDto): Promise<{ message: string }> {
		const user = await this.prisma.user.findUnique({
			where: { emailVerificationToken: payload.token },
		});

		if (!user) {
			throw new BadRequestException('Invalid email verification token');
		}

		if (user.isEmailVerified) {
			return { message: 'Email is already verified' };
		}

		await this.prisma.user.update({
			where: { id: user.id },
			data: {
				isEmailVerified: true,
				emailVerificationToken: null,
			},
		});

		await this.logAuthEvent(user.id, AuthEventType.EMAIL_VERIFICATION_SUCCESS, AuthEventStatus.SUCCESS);

		return { message: 'Email successfully verified' };
	}

	async resendEmailVerification(userId: string): Promise<{ message: string }> {
		const user = await this.prisma.user.findUnique({ where: { id: userId } });

		if (!user) {
			throw new NotFoundException('User not found');
		}

		if (user.isEmailVerified) {
			throw new BadRequestException('Email is already verified');
		}

		const emailVerificationToken = crypto.randomBytes(32).toString('hex');

		await this.prisma.user.update({
			where: { id: user.id },
			data: { emailVerificationToken },
		});

		await this.logAuthEvent(user.id, AuthEventType.EMAIL_VERIFICATION_REQUEST, AuthEventStatus.SUCCESS);

		// TODO: Send email through notification service
		console.log(`Email verification token for ${user.email}: ${emailVerificationToken}`);

		return { message: 'Verification email resent' };
	}

	async resetPassword(payload: ResetPasswordDto): Promise<{ message: string }> {
		const user = await this.prisma.user.findUnique({
			where: { resetPasswordToken: payload.token },
		});

		if (!user || !user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
			if (user) await this.logAuthEvent(user.id, AuthEventType.PASSWORD_RESET_SUCCESS, AuthEventStatus.FAILURE, { reason: 'Token expired' });
			throw new BadRequestException('Password reset token is invalid or has expired');
		}

		const passwordHash = await this.hashPassword(payload.newPassword);

		await this.prisma.user.update({
			where: { id: user.id },
			data: {
				passwordHash,
				resetPasswordToken: null,
				resetPasswordExpires: null
			},
		});

		// Invalidate all active sessions for security
		await this.prisma.session.deleteMany({ where: { userId: user.id } });

		await this.logAuthEvent(user.id, AuthEventType.PASSWORD_RESET_SUCCESS, AuthEventStatus.SUCCESS);

		return { message: 'Password has been updated' };
	}

	private async hashPassword(password: string): Promise<string> {
		return bcrypt.hash(password, authConstants.bcryptSaltOrRounds);
	}

	private async hashToken(token: string): Promise<string> {
		return crypto.createHash('sha256').update(token).digest('hex');
	}

	private signTokens(user: AuthUser): AuthTokens {
		const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };

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

	private async buildAuthResponse(userId: string, email: string, role: UserRole): Promise<AuthResponse> {
		const tokens = this.signTokens({ id: userId, email, role });

		// Calculate refresh token expiration date manually assuming "7d" format
		const days = parseInt(authConstants.refreshTokenTtl as string) || 7;
		const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

		const refreshTokenHash = await this.hashToken(tokens.refreshToken);

		await this.prisma.session.create({
			data: {
				userId,
				refreshTokenHash,
				expiresAt,
			}
		});

		return {
			...tokens,
			user: { id: userId, email, role },
		};
	}

	private async logAuthEvent(userId: string | null, event: AuthEventType, status: AuthEventStatus, metadata?: any) {
		await this.prisma.authAuditLog.create({
			data: {
				userId,
				event,
				status,
				metadata: metadata || {},
			}
		});
	}
}
