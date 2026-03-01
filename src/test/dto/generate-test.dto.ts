import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class GenerateTestDto {
  @IsBoolean()
  @IsOptional()
  followsBlueprint?: boolean;

  @IsString()
  @IsOptional()
  blueprintReferenceId?: string;

  @IsString()
  @IsOptional()
  prompt?: string;
}
