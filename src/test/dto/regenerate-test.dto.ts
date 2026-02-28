import { IsObject, IsOptional } from 'class-validator';

export class RegenerateTestDto {
  @IsObject()
  @IsOptional()
  overrides?: any;
}
