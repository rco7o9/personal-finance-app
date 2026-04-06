import { IsString, IsNotEmpty, IsInt, IsPositive } from "class-validator"
import { Type } from "class-transformer"

// A DTO (Data Transfer Object) describes the expected shape of an incoming
// request body. The decorators here are validation rules — NestJS will
// automatically reject requests that don't match with a 400 error.
// This is enforced by the global ValidationPipe set up in main.ts.
export class CreatePersonDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsInt()
  @IsPositive()
  @Type(() => Number) // coerces string "1" → number 1 when sent as form data
  homeId: number
}
