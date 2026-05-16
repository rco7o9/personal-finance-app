import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
  ParseIntPipe,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { StatementsService } from "./statements.service";
import { UploadStatementDto } from "./dto/upload-statement.dto";
import { ReviewTransactionDto } from "./dto/review-transaction.dto";

@Controller("statements")
export class StatementsController {
  constructor(private readonly statementsService: StatementsService) {}

  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File, @Body() body: UploadStatementDto) {
    return this.statementsService.uploadStatement(file, body.metadata);
  }

  @Get("pending")
  getPending(@Query("personId", ParseIntPipe) personId: number, @Query("type") type?: string) {
    return this.statementsService.getPending(personId, type);
  }

  @Patch(":id")
  reviewTransaction(@Param("id", ParseIntPipe) id: number, @Body() body: ReviewTransactionDto) {
    return this.statementsService.reviewTransaction(id, body.action, {
      assetName: body.assetName,
      amountInr: body.amountInr,
    });
  }
}
