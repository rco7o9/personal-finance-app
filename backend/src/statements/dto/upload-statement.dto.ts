import { IsNotEmpty, IsString } from "class-validator";

// The upload endpoint receives multipart/form-data with two fields:
//   file     – the binary file (handled by FileInterceptor, not this DTO)
//   metadata – a JSON string: { type, platform, format, personId }
// Validation here only ensures the metadata field is a non-empty string;
// the JSON is parsed and validated in StatementsService.uploadStatement().
export class UploadStatementDto {
  @IsString()
  @IsNotEmpty()
  metadata: string;
}
