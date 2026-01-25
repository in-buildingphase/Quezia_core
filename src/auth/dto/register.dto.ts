import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
	@IsString()
	@MinLength(3)
	@MaxLength(50)
	username: string;

	@IsEmail()
	email: string;

	@IsString()
	@IsNotEmpty()
	@MinLength(8)
	@MaxLength(100)
	@Matches(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).+$/, {
		message: 'password must include upper, lower, and number characters',
	})
	password: string;
}
